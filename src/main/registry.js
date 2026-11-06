// Reads what claude itself writes: <config dir>/sessions/<pid>.json for every account, and the alliance tag files when that mode is on.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const C = require('./consts');
const accounts = require('./accounts');

// accounts that share one sessions folder through a junction are read once
let dirsCache = { at: 0, v: [] };
function sessionDirs() {
  if (Date.now() - dirsCache.at < 30000) return dirsCache.v;
  const seen = new Set(), v = [];
  for (const id of accounts.ids()) {
    const d = path.join(accounts.configDir(id), 'sessions');
    let real;
    try { real = fs.realpathSync(d); } catch { continue; }
    if (!seen.has(real.toLowerCase())) { seen.add(real.toLowerCase()); v.push(real); }
  }
  dirsCache = { at: Date.now(), v };
  return v;
}
function refreshDirs() { dirsCache.at = 0; }

function readRegistry() {
  const out = [], pids = new Set();
  for (const dir of sessionDirs()) {
    let files = [];
    try { files = fs.readdirSync(dir); } catch { continue; }
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      try {
        const e = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        if (e && e.pid && !pids.has(e.pid)) { pids.add(e.pid); out.push(e); }
      } catch { /* half-written file, next poll */ }
    }
  }
  return out;
}

function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

// pid reuse after a reboot leaves stale files whose pid is now some other program; the start time settles it
const startCache = new Map(); // pid -> filetime string | 'gone'
let verifying = false;
function verifyStarts(pids) {
  const todo = pids.filter(p => Number.isInteger(p) && p > 0 && !startCache.has(p));
  if (!todo.length || verifying || !C.PWSH) return Promise.resolve();
  verifying = true;
  const cmd = `Get-Process -Id ${todo.join(',')} -ErrorAction SilentlyContinue | ForEach-Object { try { "$($_.Id) $($_.StartTime.ToFileTime())" } catch { "$($_.Id) ?" } }`;
  return new Promise(resolve => {
    execFile(C.PWSH, ['-NoProfile', '-NonInteractive', '-Command', cmd], { windowsHide: true, timeout: 15000 }, (err, so) => {
      verifying = false;
      const seen = new Set();
      if (!err) for (const line of so.split(/\r?\n/)) {
        const m = line.trim().match(/^(\d+) (\S+)$/);
        if (m) { seen.add(Number(m[1])); startCache.set(Number(m[1]), m[2]); }
      }
      for (const p of todo) if (!seen.has(p) && !err) startCache.set(p, 'gone');
      resolve();
    });
  });
}

function startMatches(entry) {
  const got = startCache.get(entry.pid);
  if (got === undefined || got === '?') return true; // not checked yet, trust the pid probe
  if (got === 'gone') return false;
  try { return (BigInt(got) - BigInt(entry.procStart)) ** 2n < 100000n ** 2n; } catch { return true; }
}

function isLive(entry) {
  return pidAlive(entry.pid) && startMatches(entry);
}

function forgetPid(pid) { startCache.delete(pid); }

function readText(p) { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } }

function readTag(tag) {
  if (!tag || !C.TAGS) return { state: null, summary: null, title: null };
  const state = readText(path.join(C.TAGS, tag + '.state'));
  const summary = readText(path.join(C.TAGS, tag + '.summary'));
  let title = null;
  const j = readText(path.join(C.TAGS, tag + '.json'));
  if (j) { try { title = JSON.parse(j).title || null; } catch { title = null; } }
  return { state: state ? state.trim() : null, summary: summary ? summary.trim() : null, title };
}

// Desk names look like myproject-2b; claude-N files belong to plain terminal sessions and are never touched
function isDeskName(name) { return /^[a-z0-9-]+-\d+[a-z]$/.test(name || '') && !/^claude-\d+$/.test(name); }

function cleanupFiles(name, tag) {
  if (!isDeskName(name) || !C.ALLIANCE) return;
  const targets = [];
  if (tag) targets.push(path.join(C.TAGS, tag + '.state'), path.join(C.TAGS, tag + '.summary'), path.join(C.TAGS, tag + '.json'));
  targets.push(path.join(C.STATUS, name + '.json'));
  for (const t of targets) { try { fs.unlinkSync(t); } catch { /* already gone */ } }
}

function projectSlug(dir) {
  return path.basename(dir.replace(/[\\/]+$/, '')).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'project';
}

function allocateName(slug, account, taken) {
  for (const letter of 'abcdefghijklmnopqrstuvwxyz') {
    const n = `${slug}-${account}${letter}`;
    if (!taken.has(n)) return n;
  }
  return `${slug}-${account}${Date.now().toString(36)}`;
}

function accountFromName(name) {
  let m = /^claude-(\d+)$/.exec(name || '');
  if (m) return Number(m[1]);
  m = /-(\d+)[a-z]$/.exec(name || '');
  return m ? Number(m[1]) : 0;
}

module.exports = { readRegistry, sessionDirs, refreshDirs, pidAlive, verifyStarts, isLive, forgetPid, readTag, cleanupFiles, projectSlug, allocateName, accountFromName, isDeskName };
