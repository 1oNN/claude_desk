// Bridge to an alliance root's desk-prompt.ps1, so terminal sessions and Desk sessions share one startup prompt.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const C = require('./consts');
const accounts = require('./accounts');

function getPrompt({ account, name, project, peers }) {
  if (!C.ALLIANCE) {
    if (C.CONTEXT === 'off') return Promise.resolve(null);
    const others = (peers || []).filter(x => x !== name);
    const line = `You are ${name} in Claude Desk, working in ${path.basename(project)}.`;
    return Promise.resolve(C.CONTEXT === 'team' && others.length ? `${line} Other Desk sessions in this project: ${others.join(', ')}.` : line);
  }
  return new Promise((resolve, reject) => {
    const args = ['-NoProfile', '-NonInteractive', '-File', C.DESK_PROMPT, '-N', String(account), '-Name', name, '-Project', project, '-Peers', (peers || []).join(',')];
    execFile(C.PWSH, args, { windowsHide: true, timeout: 30000, maxBuffer: 1 << 20 }, (err, so, se) => {
      if (err) return reject(new Error(`desk-prompt.ps1 failed: ${err.message} ${se}`));
      const text = so.replace(/\r?\n$/, '').trim();
      if (!text.startsWith('You are ')) return reject(new Error(`desk-prompt.ps1 printed something odd: ${text.slice(0, 120)}`));
      resolve(text);
    });
  });
}

function configDir(account) { return accounts.configDir(account); }

function transcriptPath(account, cwd, sid) {
  const slug = cwd.replace(/[^A-Za-z0-9]/g, '-');
  return path.join(configDir(account), 'projects', slug, `${sid}.jsonl`);
}

// Port of Test-AllianceInterrupted: was the last turn cut off? Reads the tail of the transcript only.
function isInterrupted(account, cwd, sid) {
  const p = transcriptPath(account, cwd, sid);
  let buf;
  try {
    const fd = fs.openSync(p, 'r');
    try {
      const size = fs.fstatSync(fd).size;
      const n = Math.min(size, 2 * 1024 * 1024);
      buf = Buffer.alloc(n);
      fs.readSync(fd, buf, 0, n, size - n);
    } finally { fs.closeSync(fd); }
  } catch { return false; }
  const lines = buf.toString('utf8').split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!/"type":"(user|assistant)"/.test(lines[i])) continue;
    let r;
    try { r = JSON.parse(lines[i]); } catch { continue; }
    if (r.isSidechain || r.isMeta) continue;
    if (r.type === 'assistant') return !!(r.message && r.message.stop_reason !== 'end_turn');
    if (r.type === 'user') {
      const c = r.message && r.message.content;
      if (typeof c === 'string' && /^\s*<(command|local-command)/.test(c)) return false;
      return true;
    }
  }
  return false;
}

function transcriptExists(account, cwd, sid) {
  try { return fs.statSync(transcriptPath(account, cwd, sid)).size > 0; } catch { return false; }
}

module.exports = { getPrompt, configDir, transcriptPath, isInterrupted, transcriptExists };
