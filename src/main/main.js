const { app, BrowserWindow, ipcMain, dialog, screen, Menu, shell, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const C = require('./consts');
const stateMod = require('./state');
const reg = require('./registry');
const memory = require('./memory');
const accounts = require('./accounts');
const usage = require('./usage');
const { PcSessions } = require('./sessions');
const { Laptop } = require('./laptop');

// keep painting while covered, so screenshots and hidden-window repaints stay current
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
if (C.GPU === 'off') app.disableHardwareAcceleration();
if (C.APP_NAME !== 'Claude Desk') app.setName(C.APP_NAME);
if (!app.requestSingleInstanceLock()) app.quit();
// the Start menu and desktop shortcuts carry the same id, so the window groups under a pinned shortcut and toasts show Desk's name and icon
// an installed build must match the id the installer gave its shortcut (package.json build.appId)
app.setAppUserModelId(C.SETTINGS.appId || (app.isPackaged ? 'io.github.1onn.claudedesk' : 'ClaudeDesk.' + app.getName()));

fs.mkdirSync(C.STATE_DIR, { recursive: true });
const LOG = path.join(C.STATE_DIR, 'desk.log');
function log(...a) {
  const line = `${new Date().toISOString()} ${a.join(' ')}\n`;
  try { fs.appendFileSync(LOG, line); } catch { /* ignore */ }
}

const state = stateMod.load();
accounts.load();
try { usage.install(); } catch (e) { log('status line install failed', e.message); }
const pc = new PcSessions(log);
const laptop = new Laptop(log);
const runtime = new Map(); // session id -> live facts not worth saving
let win = null;
let booted = false;
let quitting = false;

const key = (machine, dir) => `${machine}:${dir}`;
const rt = id => { if (!runtime.has(id)) runtime.set(id, { status: 'stopped', state: 'idle', glyph: 'idle', label: '', mem: 0 }); return runtime.get(id); };
const byId = id => state.sessions.find(s => s.id === id);
const send = (ch, ...a) => { if (win && !win.isDestroyed()) win.webContents.send(ch, ...a); };
// a big print reaches main as thousands of small chunks; a session's first chunk after a quiet spell goes at once (key echo), the rest are joined for DATA_MS
const DATA_MS = 8;
const outBuf = new Map(); // session id -> { parts, timer, last }
function flushData(id) {
  const o = outBuf.get(id); if (!o) return;
  clearTimeout(o.timer); o.timer = null; o.last = Date.now();
  if (o.parts.length) send('desk:data', id, o.parts.length === 1 ? o.parts[0] : o.parts.join(''));
  o.parts = [];
}
function sendData(id, d) {
  let o = outBuf.get(id); if (!o) outBuf.set(id, o = { parts: [], timer: null, last: 0 });
  if (!o.timer && Date.now() - o.last >= DATA_MS) { o.last = Date.now(); send('desk:data', id, d); return; }
  o.parts.push(d);
  if (!o.timer) o.timer = setTimeout(() => flushData(id), Math.max(0, DATA_MS - (Date.now() - o.last)));
}
const toast = (msg, kind) => { log('toast', msg); send('desk:toast', msg, kind || 'info'); };

function pcProjects() {
  const dirs = new Set();
  try {
    if (C.PROJECTS_ROOT) for (const d of fs.readdirSync(C.PROJECTS_ROOT, { withFileTypes: true })) {
      if (d.isDirectory() && !d.name.startsWith('.') && !d.name.startsWith('_')) dirs.add(path.join(C.PROJECTS_ROOT, d.name));
    }
  } catch { /* no projects root */ }
  for (const p of state.extraProjects) if (p.machine === 'pc') dirs.add(p.dir);
  for (const s of state.sessions) if (s.machine === 'pc') dirs.add(s.project);
  return [...dirs].sort((a, b) => path.basename(a).localeCompare(path.basename(b), undefined, { sensitivity: 'base' }))
    .map(dir => ({ key: key('pc', dir), machine: 'pc', dir, name: path.basename(dir) }));
}

function laptopProjects() {
  const dirs = new Set(laptop.projects);
  for (const p of state.extraProjects) if (p.machine === 'laptop') dirs.add(p.dir);
  for (const s of state.sessions) if (s.machine === 'laptop') dirs.add(s.project);
  return [...dirs].sort((a, b) => path.posix.basename(a).localeCompare(path.posix.basename(b), undefined, { sensitivity: 'base' }))
    .map(dir => ({ key: key('laptop', dir), machine: 'laptop', dir, name: path.posix.basename(dir) }));
}

function deskState(tagState, regStatus) {
  if (tagState === 'working' || regStatus === 'busy') return 'working';
  if (tagState === 'asking' || regStatus === 'waiting') return 'waiting';
  if (tagState === 'done' || tagState === 'running' || tagState === 'failed') return 'finished';
  return 'idle';
}
function glyphFor(tagState, regStatus) {
  if (tagState === 'working') return 'spin';
  if (tagState === 'asking') return 'asking';
  if (tagState === 'done' || tagState === 'running' || tagState === 'failed') return tagState;
  if (regStatus === 'busy') return 'spin';
  if (regStatus === 'waiting') return 'asking';
  return 'idle';
}

function peersFor(session) {
  return state.sessions.filter(s => s.id !== session.id && s.machine === session.machine && s.project === session.project && s.kind !== 'shell').map(s => s.name);
}

// ---------- PC polling ----------
const foreign = { pc: new Map(), laptop: new Map() }; // project key -> [entries]
let lastLaptopPoll = null;

function pollPc() {
  const entries = reg.readRegistry();
  reg.verifyStarts(entries.map(e => e.pid)).catch(() => {});
  const live = entries.filter(reg.isLive);
  const byPid = new Map(live.map(e => [e.pid, e]));
  const ourPids = new Set();
  for (const s of state.sessions) if (s.machine === 'pc') { const p = pc.pid(s.id); if (p) ourPids.add(p); }
  const claimed = new Set();
  let dirty = false;

  for (const s of state.sessions) {
    if (s.machine !== 'pc') continue;
    const r = rt(s.id);
    const rec = pc.record(s.id);
    if (s.kind === 'shell') {
      r.status = rec ? (rec.exited ? 'exited' : 'live') : r.status;
      r.state = 'idle'; r.glyph = 'shell'; r.pid = rec && !rec.exited ? rec.pid : null;
      continue;
    }
    if (rec && !rec.exited) {
      // after /tui or an in-session relaunch the registry file moves to a child pid under the same name
      let entry = byPid.get(rec.pid) || live.find(e => e.name === s.name && !ourPids.has(e.pid) && !claimed.has(e.pid));
      if (entry) {
        claimed.add(entry.pid);
        if (entry.sessionId && entry.sessionId !== s.sid) { log('sid changed', s.name, s.sid, '->', entry.sessionId); s.sid = entry.sessionId; dirty = true; }
        r.regStatus = entry.status; r.pid = entry.pid; r.registered = true;
      } else { r.regStatus = null; r.pid = rec.pid; }
      const tag = reg.readTag(s.tag);
      r.tagState = tag.state;
      r.state = deskState(tag.state, r.regStatus);
      r.glyph = glyphFor(tag.state, r.regStatus);
      r.label = tag.summary || tag.title || '';
      r.status = 'live';
      r.elsewhere = null;
    } else {
      // an exited or never-started session may have been picked up by a terminal or VS Code meanwhile
      const holder = live.find(e => e.sessionId === s.sid);
      if (holder) { r.status = 'elsewhere'; r.elsewhere = holder.name || `pid ${holder.pid}`; r.pid = holder.pid; r.state = 'idle'; r.glyph = 'elsewhere'; r.regStatus = null; }
      else if (rec && rec.exited) { r.status = 'exited'; r.state = 'idle'; r.glyph = 'exited'; r.pid = null; r.regStatus = null; r.elsewhere = null; }
      else if (r.status === 'elsewhere') { r.status = 'stopped'; r.elsewhere = null; r.glyph = 'exited'; r.pid = null; }
    }
  }
  // sessions in a project that Desk did not start: shown greyed so nothing gets opened twice
  const ours = new Set(); for (const s of state.sessions) { const r = runtime.get(s.id); if (r && r.pid) ours.add(r.pid); }
  const roots = pcProjects();
  foreign.pc = new Map();
  for (const e of live) {
    if (ours.has(e.pid) || claimed.has(e.pid) || e.kind !== 'interactive' || !e.cwd) continue;
    const proj = roots.find(p => e.cwd.toLowerCase() === p.dir.toLowerCase() || e.cwd.toLowerCase().startsWith(p.dir.toLowerCase() + '\\'));
    if (!proj) continue;
    if (!foreign.pc.has(proj.key)) foreign.pc.set(proj.key, []);
    foreign.pc.get(proj.key).push({ pid: e.pid, name: e.name || `pid ${e.pid}`, sid: e.sessionId, cwd: e.cwd, regStatus: e.status, account: reg.accountFromName(e.name), mem: memFor(e.pid, 'pc') });
  }
  if (dirty) stateMod.save(state);
}

const memCache = { pc: new Map(), laptop: new Map() };
function memFor(pid, machine) { return memCache[machine].get(pid) || 0; }

async function samplePcMemory() {
  const { rows } = await memory.sample();
  memCache.pc = new Map();
  for (const s of state.sessions) {
    if (s.machine !== 'pc') continue;
    const r = rt(s.id);
    if (r.pid) { r.mem = memory.treeBytes(rows, r.pid); memCache.pc.set(r.pid, r.mem); } else r.mem = 0;
  }
  for (const list of foreign.pc.values()) for (const f of list) { f.mem = memory.treeBytes(rows, f.pid); memCache.pc.set(f.pid, f.mem); }
}

// ---------- laptop ----------
function applyLaptopPoll(p) {
  lastLaptopPoll = { at: Date.now(), mem: p.mem };
  const live = p.sessions;
  const bySid = new Map(live.map(e => [e.sessionId, e]));
  const rows = p.ps.map(([pid, ppid, rss]) => ({ pid, ppid, ws: rss * 1024 }));
  const ourPids = new Set();
  for (const s of state.sessions) {
    if (s.machine !== 'laptop') continue;
    const r = rt(s.id);
    const tm = p.tmux[s.name];
    if (s.kind === 'shell') {
      r.status = tm ? (tm.dead ? 'exited' : 'live') : (r.status === 'starting' ? 'starting' : 'stopped');
      r.state = 'idle'; r.glyph = 'shell';
      if (tm && !tm.dead) { r.pid = tm.pid; r.mem = memory.treeBytes(rows, tm.pid); ourPids.add(tm.pid); }
      continue;
    }
    // the claude inside our tmux session is the registry entry whose pid sits under the pane pid
    let entry = null;
    if (tm && !tm.dead) {
      const under = new Set([tm.pid]);
      let grew = true;
      while (grew) { grew = false; for (const row of rows) if (under.has(row.ppid) && !under.has(row.pid)) { under.add(row.pid); grew = true; } }
      entry = live.find(e => under.has(e.pid)) || null;
    }
    if (entry) {
      if (entry.sessionId && entry.sessionId !== s.sid) { log('laptop sid changed', s.name, s.sid, '->', entry.sessionId); s.sid = entry.sessionId; stateMod.save(state); }
      ourPids.add(entry.pid);
      const tag = p.tags[s.tag] || {};
      r.regStatus = entry.status; r.pid = entry.pid; r.tagState = tag.state || null;
      r.state = deskState(tag.state, entry.status);
      r.glyph = glyphFor(tag.state, entry.status);
      r.label = tag.summary || tag.title || '';
      r.status = 'live'; r.elsewhere = null;
      r.mem = memory.treeBytes(rows, tm.pid);
    } else if (tm) {
      // tmux session exists but claude is gone or not registered yet
      if (r.status === 'starting' && Date.now() - (r.startedAt || 0) < 20000) { /* still booting */ }
      else { r.status = tm.dead ? 'exited' : (r.status === 'starting' ? 'starting' : 'exited'); r.state = 'idle'; r.glyph = 'exited'; r.pid = null; r.mem = 0; }
    } else {
      const holder = bySid.get(s.sid);
      if (holder) { r.status = 'elsewhere'; r.elsewhere = holder.name || `pid ${holder.pid}`; r.pid = holder.pid; r.state = 'idle'; r.glyph = 'elsewhere'; }
      else if (r.status !== 'starting' && r.status !== 'queued') { r.status = 'stopped'; r.glyph = 'exited'; r.state = 'idle'; r.pid = null; r.mem = 0; }
    }
  }
  const roots = laptopProjects();
  foreign.laptop = new Map();
  for (const e of live) {
    if (ourPids.has(e.pid) || e.kind !== 'interactive' || !e.cwd) continue;
    const proj = roots.find(pr => e.cwd === pr.dir || e.cwd.startsWith(pr.dir + '/'));
    if (!proj) continue;
    if (!foreign.laptop.has(proj.key)) foreign.laptop.set(proj.key, []);
    foreign.laptop.get(proj.key).push({ pid: e.pid, name: e.name || `pid ${e.pid}`, sid: e.sessionId, cwd: e.cwd, regStatus: e.status, account: reg.accountFromName(e.name), mem: memory.treeBytes(rows, e.pid) });
  }
}

let laptopPolling = false;
async function pollLaptop() {
  if (laptop.status !== 'online' || laptopPolling) return;
  laptopPolling = true;
  try { applyLaptopPoll(await laptop.poll()); } catch (e) { log('laptop poll error', e.message); }
  laptopPolling = false;
}

const laptopQueue = [];
let laptopDraining = false;
function laptopEnqueue(session, opts) {
  if (laptopQueue.some(q => q.session.id === session.id)) return;
  laptopQueue.push({ session, opts });
  rt(session.id).status = 'queued';
  drainLaptop();
}
async function drainLaptop() {
  if (laptopDraining) return;
  laptopDraining = true;
  while (laptopQueue.length) {
    const { session, opts } = laptopQueue.shift();
    const r = rt(session.id);
    try {
      r.status = 'starting'; r.startedAt = Date.now(); r.error = null;
      const size = { cols: pc.size.cols, rows: pc.size.rows };
      if (session.kind === 'shell') await laptop.startShell(session, size);
      else await laptop.start(session, { ...opts, peers: peersFor(session), ...size });
      send('desk:started', session.id);
      // wait for the registry entry before the next start, like the PC queue
      const until = Date.now() + 8000;
      while (Date.now() < until && session.kind !== 'shell') {
        await new Promise(res => setTimeout(res, 1500));
        await pollLaptop();
        if (r.status === 'live') break;
      }
    } catch (e) {
      r.status = 'stopped'; r.error = e.message; r.glyph = 'exited';
      toast(`${session.name}: ${e.message}`, 'error');
    }
  }
  laptopDraining = false;
}

laptop.on('online', async () => {
  try { await pollLaptop(); } catch { /* reported by poll */ }
  // reattach or restart what we had; anything whose tmux session is alive is only attached to
  for (const s of state.sessions.filter(x => x.machine === 'laptop').sort((a, b) => a.order - b.order)) {
    const r = rt(s.id);
    if (r.status === 'live' || r.status === 'elsewhere') continue;
    laptopEnqueue(s, { resume: true });
  }
  pushSnapshot();
});
laptop.on('status', () => pushSnapshot());
laptop.on('data', sendData);
laptop.on('detached', id => { const s = byId(id); if (s && rt(id).status !== 'live') send('desk:exit', id, { exitCode: null }); });

// ---------- snapshot ----------
function snapshot() {
  const projects = [...pcProjects(), ...laptopProjects()].map(p => {
    const sessions = state.sessions.filter(s => s.machine === p.machine && s.project === p.dir);
    let badge = 0, mem = 0;
    for (const s of sessions) { const r = rt(s.id); if (r.status === 'live' && (r.state === 'waiting' || r.state === 'finished')) badge++; mem += r.mem || 0; }
    return { ...p, badge, mem, foreign: foreign[p.machine].get(p.key) || [] };
  });
  const sessions = state.sessions.map(s => ({ ...s, ...rt(s.id) }));
  const totals = { pc: 0, laptop: 0 };
  for (const s of sessions) totals[s.machine] += s.mem || 0;
  return {
    projects, sessions, ui: state.ui, colours: C.COLOURS, roles: C.ROLES, accountList: accountView(),
    laptop: { status: laptop.status, error: laptop.error, host: laptop.cfg ? laptop.cfg.host : null, mem: lastLaptopPoll ? lastLaptopPoll.mem : null, accounts: laptopAccounts },
    totals, accounts: readAccounts(), setup: { ...C.setup(), start }, now: Date.now(),
  };
}
// one stamp per session for the time-in-state column, and the taskbar flash on a transition into waiting or failed while the window is in the background
const stateKeys = new Map();
function noteTransitions() {
  for (const [id, r] of runtime) {
    const key = `${r.status}|${r.state}|${r.glyph}`;
    const was = stateKeys.get(id);
    if (key === was) continue;
    stateKeys.set(id, key); r.stateSince = Date.now();
    if (was === undefined || !win || win.isDestroyed() || win.isFocused()) continue;
    if (r.status === 'live' && (r.state === 'waiting' || r.glyph === 'failed') && (!state.ui || state.ui.flash !== false)) { win.flashFrame(true); log('attention flash', (byId(id) || {}).name, was, '->', key); }
  }
}
function pushSnapshot() { noteTransitions(); send('desk:snapshot', snapshot()); }

// Usage limits per account from the status files the Claude sessions write. Read on each snapshot, cached for 10 s.
let accountsCache = { at: 0, v: {} };
// names, colours and sign-in state; the sign-in check stats two files per account, so it is cached for 2 s
let viewCache = { at: 0, v: [] };
function accountView() {
  if (Date.now() - viewCache.at > 2000) viewCache = { at: Date.now(), v: accounts.view() };
  return viewCache.v;
}
function readAccounts() {
  if (Date.now() - accountsCache.at < 10000) return accountsCache.v;
  const v = usage.read();
  if (C.STATUS) for (const n of accounts.ids()) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(C.STATUS, `claude-${n}.json`), 'utf8'));
      v[n] = { five_hour: j.five_hour ?? null, seven_day: j.seven_day ?? null, five_hour_reset: j.five_hour_reset ?? null, seven_day_reset: j.seven_day_reset ?? null, updated: j.updated ?? null };
    } catch { /* missing or mid-write */ }
    const cost = readCost(n);
    if (cost) v[n] = Object.assign(v[n] || {}, { cost });
  }
  accountsCache = { at: Date.now(), v };
  return v;
}

// Only prepaid (API credit) accounts pay per token, and alliance.py keeps cost files only for those: one per session per
// month, total = base + last. The status line refreshes every 30 s, so a file touched in the last 2 minutes is a running session.
function readCost(n) {
  const root = path.join(C.STATUS, 'cost', `claude-${n}`);
  if (!fs.existsSync(root)) return null;
  const d = new Date(), month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  let total = 0, live = 0, open = 0, files = [];
  try { files = fs.readdirSync(path.join(root, month)).filter(f => f.endsWith('.json')); } catch { /* none this month */ }
  for (const f of files) {
    try {
      const r = JSON.parse(fs.readFileSync(path.join(root, month, f), 'utf8'));
      total += (r.base || 0) + (r.last || 0);
      if (Date.now() / 1000 - (r.t || 0) < 120) { live += (r.base || 0) + (r.last || 0); open++; }
    } catch { /* mid-write */ }
  }
  return { month, total, live, open, sessions: files.length };
}

// which accounts exist on the remote machine; settings.json laptopAccounts, default the main account only
let laptopAccounts = Array.isArray(C.SETTINGS.laptopAccounts) ? C.SETTINGS.laptopAccounts.filter(Number.isInteger) : [1];

// ---------- session commands ----------
function createSession({ machine, project, account, kind }) {
  const slug = reg.projectSlug(project);
  const taken = new Set(state.sessions.filter(s => s.machine === machine).map(s => s.name));
  if (machine === 'pc') for (const e of reg.readRegistry()) if (e.name) taken.add(e.name);
  const sid = crypto.randomUUID();
  let name, tag = null;
  if (kind === 'shell') {
    let n = 1; while (taken.has(`${slug}-sh${n}`)) n++;
    name = `${slug}-sh${n}`; account = 0;
  } else {
    name = reg.allocateName(slug, account, taken);
    tag = `${name}-${sid.slice(0, 8)}`;
  }
  const order = state.sessions.reduce((m, s) => Math.max(m, s.order || 0), 0) + 1;
  const s = { id: crypto.randomUUID(), machine, project, account, kind: kind || 'claude', name, sid, cwd: project, tag, order };
  state.sessions.push(s);
  stateMod.save(state);
  log('new session', machine, name, sid, project);
  return s;
}

function launch(s, opts) {
  if (opts.resume && s.kind !== 'shell') {
    // never open a conversation twice: refuse while any live process holds its id
    const holder = s.machine === 'pc' ? reg.readRegistry().filter(reg.isLive).find(e => e.sessionId === s.sid) : null;
    if (holder || rt(s.id).status === 'elsewhere') {
      const r = rt(s.id); r.status = 'elsewhere'; r.glyph = 'elsewhere'; r.state = 'idle';
      if (holder) { r.elsewhere = holder.name || `pid ${holder.pid}`; r.pid = holder.pid; }
      log('resume refused, held elsewhere', s.name, r.elsewhere);
      return;
    }
  }
  if (s.machine === 'pc') pc.enqueue(s, { ...opts, peers: peersFor(s) });
  else if (laptop.status === 'online') laptopEnqueue(s, opts);
  else { rt(s.id).status = 'offline'; rt(s.id).glyph = 'offline'; }
}

async function stopSession(id) {
  const s = byId(id); if (!s) return;
  if (s.machine === 'pc') pc.kill(id);
  else { laptop.detach(id); await laptop.kill(s.name).catch(() => {}); rt(id).status = 'stopped'; rt(id).glyph = 'exited'; }
}

async function forgetSession(id) {
  const s = byId(id); if (!s) return;
  await stopSession(id);
  if (s.machine === 'pc') { pc.drop(id); reg.cleanupFiles(s.name, s.tag); }
  else await laptop.cleanup(s.name, s.tag, true);
  state.sessions = state.sessions.filter(x => x.id !== id);
  runtime.delete(id);
  for (const v of Object.values(state.ui.views || {})) if (v.slots) v.slots = v.slots.map(x => x === id ? null : x);
  stateMod.save(state);
}

async function sayToProject(projectKey, text) {
  const sent = [], skipped = [];
  const sessions = state.sessions.filter(s => key(s.machine, s.project) === projectKey && s.kind !== 'shell');
  for (const s of sessions) {
    const r = rt(s.id);
    if (r.status !== 'live') { skipped.push({ name: s.name, why: r.status }); continue; }
    if (r.state === 'working' || r.state === 'waiting') { skipped.push({ name: s.name, why: r.state }); continue; }
    try {
      if (s.machine === 'pc') {
        pc.write(s.id, text);
        await new Promise(res => setTimeout(res, 250));
        pc.write(s.id, '\r');
      } else await laptop.sendKeys(s.name, text);
      sent.push(s.name);
    } catch (e) { skipped.push({ name: s.name, why: e.message }); }
  }
  log('say', projectKey, JSON.stringify({ sent, skipped }));
  return { sent, skipped };
}

// ---------- pc events ----------
pc.on('data', sendData);
pc.on('status', (id, st) => { const r = rt(id); r.status = st; if (st === 'live') { r.startedAt = Date.now(); r.error = null; send('desk:started', id); } pushSnapshot(); });
pc.on('error', (id, msg) => { const r = rt(id); r.status = 'stopped'; r.error = msg; r.glyph = 'exited'; toast(`${(byId(id) || {}).name}: ${msg}`, 'error'); pushSnapshot(); });
pc.on('exit', (id, e) => {
  const s = byId(id);
  const r = rt(id);
  r.status = 'exited'; r.state = 'idle'; r.glyph = 'exited'; r.pid = null;
  if (s && !quitting) {
    // keep the summary label, drop the state so it does not show as finished forever
    if (s.tag && C.TAGS) { try { fs.unlinkSync(path.join(C.TAGS, s.tag + '.state')); } catch { /* none */ } }
    if (reg.isDeskName(s.name) && C.STATUS) { try { fs.unlinkSync(path.join(C.STATUS, s.name + '.json')); } catch { /* none */ } }
  }
  flushData(id); outBuf.delete(id);
  send('desk:exit', id, e);
  pushSnapshot();
});

// ---------- boot ----------
let start = null;
function boot() {
  if (booted) return;
  booted = true;
  pollPc();
  const entries = reg.readRegistry().filter(reg.isLive);
  // each resumed Claude session is 400 MB or more of RAM, so by default only the panes of the project last shown come back
  const cur = state.ui && state.ui.current, view = cur && state.ui.views && state.ui.views[cur];
  const open = new Set(C.RESUME === 'current' && view ? (view.slots || []).filter(Boolean) : []);
  start = { policy: C.RESUME, started: 0, waiting: 0, saved: 0 };
  for (const s of state.sessions.filter(x => x.machine === 'pc').sort((a, b) => a.order - b.order)) {
    start.saved++;
    const holder = s.kind !== 'shell' && entries.find(e => e.sessionId === s.sid);
    if (holder) { const r = rt(s.id); r.status = 'elsewhere'; r.elsewhere = holder.name || `pid ${holder.pid}`; log('held elsewhere', s.name, holder.name, holder.pid); continue; }
    if (C.RESUME === 'all' || open.has(s.id)) { launch(s, { resume: true }); start.started++; }
    else { const r = rt(s.id); r.status = 'stopped'; r.glyph = 'exited'; r.state = 'idle'; start.waiting++; }
  }
  log('start', JSON.stringify(start));
  for (const s of state.sessions.filter(x => x.machine === 'laptop')) { const r = rt(s.id); r.status = 'offline'; r.glyph = 'offline'; }
  laptop.connect();
  setInterval(() => { pollPc(); pushSnapshot(); }, C.POLL_PC_MS);
  setInterval(pollLaptop, C.POLL_LAPTOP_MS);
  samplePcMemory().catch(() => {});
  let memTick = 0;
  setInterval(() => { memTick++; if ((state.ui && state.ui.showMem) || memTick % C.MEMORY_IDLE_TICKS === 0) samplePcMemory().catch(() => {}); }, C.MEMORY_MS);
}

// ---------- IPC ----------
// only Desk's own page may call in; a frame that navigated elsewhere, or a second window, gets nothing
function trusted(e) {
  return !!win && !win.isDestroyed() && e.sender === win.webContents && e.senderFrame === win.webContents.mainFrame && /^file:/.test(e.senderFrame.url);
}
function handle(ch, fn) { ipcMain.handle(ch, (e, ...a) => { if (!trusted(e)) { log('ipc refused', ch); throw new Error('refused'); } return fn(e, ...a); }); }
function on(ch, fn) { ipcMain.on(ch, (e, ...a) => { if (trusted(e)) fn(e, ...a); else log('ipc refused', ch); }); }
const isAbsDir = p => typeof p === 'string' && path.isAbsolute(p) && (() => { try { return fs.statSync(p).isDirectory(); } catch { return false; } })();
const isAbsFile = p => typeof p === 'string' && path.isAbsolute(p) && (() => { try { return fs.statSync(p).isFile(); } catch { return false; } })();
const isRemotePath = p => typeof p === 'string' && p.length < 1024 && /^(\/|~\/)/.test(p) && !/[\0\n\r]/.test(p);
const cells = (n, lo, hi) => { n = Math.round(Number(n)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : 0; };
function startOpts(o) {
  o = o || {};
  const machine = o.machine === 'laptop' ? 'laptop' : o.machine === 'pc' ? 'pc' : null;
  const kind = o.kind === 'shell' ? 'shell' : 'claude';
  if (!machine) throw new Error('bad machine');
  if (machine === 'pc' ? !isAbsDir(o.project) : !isRemotePath(o.project)) throw new Error('bad project folder');
  const ids = machine === 'pc' ? accounts.ids() : laptopAccounts;
  const account = kind === 'shell' ? 0 : Number(o.account);
  if (kind !== 'shell' && !(Number.isInteger(account) && ids.includes(account))) throw new Error('bad account');
  return { machine, project: machine === 'pc' ? path.normalize(o.project) : o.project, account, kind };
}

handle('desk:init', () => { boot(); return snapshot(); });
handle('desk:start', (_e, opts) => { const s = createSession(startOpts(opts)); launch(s, { resume: false }); return { ...s, ...rt(s.id) }; });
handle('desk:resume', (_e, id) => { const s = byId(id); if (s) launch(s, { resume: true }); });
handle('desk:stop', (_e, id) => stopSession(id));
handle('desk:forget', (_e, id) => forgetSession(id));
handle('desk:attach', async (_e, id, cols, rows) => {
  const s = byId(id); if (!s) return { replay: '' };
  cols = cells(cols, 2, 1000); rows = cells(rows, 2, 500);
  if (cols > 0 && rows > 0) pc.setDefaultSize(cols, rows);
  // output still waiting in outBuf is already in the ring, so the replay carries it
  if (s.machine === 'pc') { const o = outBuf.get(id); if (o) o.parts = []; pc.resize(id, cols, rows); return { replay: pc.replay(id) }; }
  if (laptop.status !== 'online') return { replay: '', error: 'laptop offline' };
  try { await laptop.attach(s, cols, rows); return { replay: '' }; } catch (e) { return { replay: '', error: e.message }; }
});
on('desk:write', (_e, id, data) => { const s = byId(id); if (!s || typeof data !== 'string') return; if (s.machine === 'pc') pc.write(id, data); else laptop.write(id, data); });
on('desk:resize', (_e, id, cols, rows) => { const s = byId(id); if (!s) return; cols = cells(cols, 2, 1000); rows = cells(rows, 2, 500); if (s.machine === 'pc') pc.resize(id, cols, rows); else laptop.resize(id, cols, rows); });
handle('desk:say', (_e, projectKey, text) => sayToProject(projectKey, text));
on('desk:ui', (_e, ui) => { if (!ui || typeof ui !== 'object' || Array.isArray(ui)) return; state.ui = ui; stateMod.save(state); });
handle('desk:addProject', async (_e, machine, dir) => {
  if (machine === 'pc' && !dir) {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'], defaultPath: C.PROJECTS_ROOT || undefined });
    if (r.canceled || !r.filePaths.length) return null;
    dir = r.filePaths[0];
  }
  if (!dir) return null;
  if (machine === 'pc' ? !isAbsDir(dir) : machine === 'laptop' ? !isRemotePath(dir) : true) return null;
  if (machine === 'pc') dir = path.normalize(dir);
  if (!state.extraProjects.some(p => p.machine === machine && p.dir === dir)) { state.extraProjects.push({ machine, dir }); stateMod.save(state); }
  pushSnapshot();
  return dir;
});
// accounts: the store lives in <state>/accounts.json; signing in happens in a Claude pane, so no token passes through here
function accountsChanged() { viewCache.at = 0; accountsCache.at = 0; reg.refreshDirs(); pushSnapshot(); return accountView(); }
handle('desk:accountAdd', (_e, o) => {
  o = o && typeof o === 'object' ? o : {};
  if (o.configDir != null && !isAbsDir(o.configDir)) throw new Error('that folder does not exist');
  const a = accounts.add({ name: o.name, colour: o.colour, role: o.role, configDir: o.configDir || null, share: o.share !== false });
  log('account added', a.id, a.configDir);
  return accountsChanged();
});
handle('desk:accountUpdate', (_e, id, patch) => { accounts.update(Number(id), patch && typeof patch === 'object' ? patch : {}); return accountsChanged(); });
handle('desk:accountRemove', (_e, id) => { accounts.remove(Number(id)); log('account removed', id); return accountsChanged(); });
handle('desk:setupDone', () => { accounts.confirm(); return accountsChanged(); });
handle('desk:laptopReconnect', () => { laptop.closedByUs = false; laptop.connect(); });
handle('desk:memoryNow', async () => { await samplePcMemory(); await pollLaptop(); pushSnapshot(); return snapshot(); });
on('desk:log', (_e, s) => log('renderer', s));
// setup: paths that differ per machine, kept in <state>/settings.json; env DESK_* wins over the file
handle('desk:settings', () => ({ ...C.readSettings(), setup: C.setup() }));
handle('desk:setSettings', (_e, patch) => {
  const allowed = {};
  // a path is either cleared or a real one of the right kind; claude must be an .exe so cmd.exe never reparses its arguments
  const ok = {
    projectsRoot: isAbsDir, allianceRoot: isAbsDir,
    claudeExe: p => isAbsFile(p) && /^claude\.exe$/i.test(path.basename(p)),
    pwsh: p => isAbsFile(p) && /^(pwsh|powershell)\.exe$/i.test(path.basename(p)),
  };
  for (const k of Object.keys(ok)) if (k in (patch || {})) {
    const v = typeof patch[k] === 'string' ? patch[k].trim() : '';
    if (v && !ok[k](v)) throw new Error(`${k}: not a usable path`);
    allowed[k] = v ? path.normalize(v) : null;
  }
  if ('resume' in (patch || {})) allowed.resume = ['all', 'current', 'none'].includes(patch.resume) ? patch.resume : null;
  if ('gpu' in (patch || {})) allowed.gpu = patch.gpu === 'off' ? 'off' : null;
  if ('context' in (patch || {})) allowed.context = ['name', 'team'].includes(patch.context) ? patch.context : null;
  if ('carryOn' in (patch || {})) allowed.carryOn = patch.carryOn === true ? true : null;
  if ('usage' in (patch || {})) allowed.usage = patch.usage === 'off' ? 'off' : null;
  if ('updates' in (patch || {})) allowed.updates = patch.updates === 'off' ? 'off' : null;
  C.writeSettings(allowed);
  log('settings', JSON.stringify(allowed));
  pushSnapshot();
  return { ...C.readSettings(), setup: C.setup() };
});
// updates come from the GitHub releases of the public repo, only in an installed build; the download installs when Desk closes
let updater = null, updateReady = null;
function startUpdater() {
  if (!app.isPackaged || C.SETTINGS.updates === 'off' || process.env.DESK_NO_UPDATE) return;
  try { updater = require('electron-updater').autoUpdater; } catch (e) { log('updater', e.message); return; }
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  updater.logger = { info: m => log('update', m), warn: m => log('update warn', m), error: m => log('update error', m), debug: () => {} };
  updater.on('update-downloaded', i => { updateReady = i.version; toast(`Claude Desk ${i.version} is downloaded and installs when you close Desk`); pushSnapshot(); });
  updater.on('error', e => log('update error', e && e.message));
  const check = () => updater.checkForUpdates().catch(e => log('update check', e.message));
  setTimeout(check, 15000);
  setInterval(check, 6 * 3600 * 1000);
}
handle('desk:checkUpdate', async () => {
  const current = app.getVersion();
  if (!app.isPackaged) return { current, note: 'Updates run only in an installed build' };
  if (C.SETTINGS.updates === 'off') return { current, note: 'Update checks are off' };
  if (!updater) return { current, note: 'The updater did not start; see desk.log' };
  if (updateReady) return { current, latest: updateReady, note: `${updateReady} installs when you close Desk` };
  const r = await updater.checkForUpdates();
  const latest = r && r.updateInfo && r.updateInfo.version;
  return { current, latest, note: latest && latest !== current ? `Downloading ${latest}` : 'Desk is up to date' };
});
handle('desk:pickPath', async (_e, what, defaultPath) => {
  const file = what === 'file';
  const r = await dialog.showOpenDialog(win, { properties: [file ? 'openFile' : 'openDirectory'], defaultPath: typeof defaultPath === 'string' && defaultPath ? defaultPath : undefined, filters: file ? [{ name: 'Programs', extensions: ['exe'] }] : [] });
  return r.canceled || !r.filePaths.length ? null : r.filePaths[0];
});
handle('desk:openPath', (_e, what) => {
  const acc = typeof what === 'string' && /^account:\d+$/.test(what) ? accounts.get(Number(what.slice(8))) : null;
  const target = acc ? accounts.configDir(acc.id) : what === 'log' ? LOG : what === 'state' ? C.STATE_DIR : what === 'settings' ? C.SETTINGS_FILE : null;
  if (!target) return 'unknown';
  if (what === 'settings' && !fs.existsSync(target)) C.writeSettings({});
  return shell.openPath(target);
});
on('desk:zoom', (_e, factor) => { const f = Math.min(1.6, Math.max(0.8, Number(factor) || 1)); if (win) win.webContents.setZoomFactor(f); });
handle('desk:clipRead', () => clipboard.readText());
on('desk:clipWrite', (_e, text) => clipboard.writeText(String(text || '').slice(0, 10 * 1024 * 1024)));
// Ctrl+click on a terminal link: only http and https leave the app, in the default browser
on('desk:openUrl', (_e, url) => { try { const u = new URL(String(url)); if (u.protocol === 'http:' || u.protocol === 'https:') shell.openExternal(u.href); } catch { /* not a URL */ } });
on('desk:devtools', () => { if (win && !app.isPackaged) win.webContents.toggleDevTools(); });

// ---------- debug channel (scripted evidence only: a source checkout with DESK_DEBUG_DIR set) ----------
// it runs any JavaScript it is handed, so an installed build never has it
const DEBUG_DIR = !app.isPackaged && process.env.DESK_DEBUG_DIR ? process.env.DESK_DEBUG_DIR : null;
if (DEBUG_DIR) {
  fs.mkdirSync(DEBUG_DIR, { recursive: true });
  // commands left over from an earlier run are not this run's to execute
  for (const f of fs.readdirSync(DEBUG_DIR)) if (f.endsWith('.json') && !f.endsWith('.out.json')) { try { fs.unlinkSync(path.join(DEBUG_DIR, f)); } catch { /* busy */ } }
  log('debug channel on', DEBUG_DIR);
  const handlers = {
    shot: async c => { const img = await win.capturePage(); fs.writeFileSync(c.file, img.toPNG()); return { ok: true, file: c.file }; },
    eval: async c => win.webContents.executeJavaScript(c.js, true),
    snapshot: async () => snapshot(),
    start: async c => { const s = createSession(c); launch(s, { resume: false }); return s; },
    resume: async c => { const s = byId(c.id); if (s) launch(s, { resume: true }); return s; },
    stop: async c => stopSession(c.id),
    forget: async c => forgetSession(c.id),
    say: async c => sayToProject(c.projectKey, c.text),
    write: async c => { const s = byId(c.id); if (s.machine === 'pc') pc.write(c.id, c.text); else laptop.write(c.id, c.text); return true; },
    memory: async () => { await samplePcMemory(); await pollLaptop(); return snapshot(); },
    quit: async () => { setTimeout(() => app.quit(), 100); return true; },
    menu: async () => { const m = Menu.getApplicationMenu(); return m ? m.items.map(i => ({ label: i.label, items: i.submenu ? i.submenu.items.map(x => ({ label: x.label, role: x.role, acc: x.accelerator })) : [] })) : null; },
    key: async c => { for (const ev of c.events) { win.webContents.sendInputEvent(ev); await new Promise(r => setTimeout(r, c.gap || 30)); } return true; },
    // frame series for the design evidence: capturePage every `every` ms, `n` frames, optional rect
    burst: async c => {
      const n = c.n || 20, every = c.every || 50, dir = c.dir;
      fs.mkdirSync(dir, { recursive: true });
      const frames = [], t0 = Date.now();
      for (let i = 0; i < n; i++) {
        const t = Date.now();
        const img = c.rect ? await win.capturePage(c.rect) : await win.capturePage();
        const file = path.join(dir, `f${String(i).padStart(3, '0')}.png`);
        fs.writeFileSync(file, img.toPNG());
        frames.push({ file, at: t - t0 });
        const wait = every - (Date.now() - t);
        if (wait > 0) await new Promise(r => setTimeout(r, wait));
      }
      return { frames };
    },
  };
  setInterval(() => {
    let files = [];
    try { files = fs.readdirSync(DEBUG_DIR).filter(f => f.endsWith('.json') && !f.endsWith('.out.json')).sort(); } catch { return; }
    for (const f of files) {
      const fp = path.join(DEBUG_DIR, f);
      let c; try { c = JSON.parse(fs.readFileSync(fp, 'utf8')); } catch { continue; }
      fs.unlinkSync(fp);
      const outFile = fp.replace(/\.json$/, '.out.json');
      const h = handlers[c.op];
      (h ? h(c) : Promise.reject(new Error('unknown op ' + c.op)))
        .then(r => fs.writeFileSync(outFile, JSON.stringify({ ok: true, result: r === undefined ? null : r })))
        .catch(e => fs.writeFileSync(outFile, JSON.stringify({ ok: false, error: e.message })));
    }
  }, 300);
}

// ---------- window ----------
app.whenReady().then(() => {
  win = new BrowserWindow({
    width: 1600, height: 950, minWidth: 900, minHeight: 500,
    title: C.APP_NAME, backgroundColor: '#0C0C0C', icon: path.join(__dirname, '..', 'assets', 'icon.ico'),
    webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), backgroundThrottling: false, contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, webviewTag: false, spellcheck: false },
  });
  // no menu at all: the default one owns Ctrl+W, Ctrl+R, Ctrl+Plus and friends, which must reach the terminal
  Menu.setApplicationMenu(null);
  win.setMenuBarVisibility(false);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  // the page never leaves index.html: a dropped file or a stray link would otherwise load with the desk API
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.webContents.on('will-redirect', e => e.preventDefault());
  win.webContents.on('will-attach-webview', e => e.preventDefault());
  win.webContents.session.setPermissionRequestHandler((_wc, perm, cb) => cb(perm === 'notifications' || perm === 'clipboard-sanitized-write'));
  win.webContents.on('before-input-event', (e, input) => { if (input.type === 'keyDown' && input.key === 'F12') { if (!app.isPackaged) win.webContents.toggleDevTools(); e.preventDefault(); } });
  win.webContents.on('did-finish-load', () => {
    const z = Number(state.ui && state.ui.uiScale); if (z && z !== 1) win.webContents.setZoomFactor(Math.min(1.6, Math.max(0.8, z)));
    if (!C.CLAUDE_EXE) setTimeout(() => toast('Claude Code was not found. Open Settings and point Desk at claude.exe.', 'error'), 800);
  });
  win.webContents.on('console-message', (_e, level, msg, line, src) => { if (level >= 2) log('console', level, msg, `${src}:${line}`); });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.on('close', () => log('window close event'));
  if (DEBUG_DIR) {
    const u32 = b => (b && b.length >= 4) ? b.readUInt32LE(0) : null;
    const where = () => { try { const c = screen.getCursorScreenPoint(), b = win.getBounds();
      return JSON.stringify({ focused: win.isFocused(), visible: win.isVisible(), minimized: win.isMinimized(), cursor: c, bounds: b,
        inWindow: c.x >= b.x && c.x <= b.x + b.width && c.y >= b.y && c.y <= b.y + b.height, nearClose: c.x >= b.x + b.width - 60 && c.y >= b.y && c.y <= b.y + 40 }); } catch (e) { return e.message; } };
    win.hookWindowMessage(0x0010, () => log('WM_CLOSE', where()));
    win.hookWindowMessage(0x0112, (w, l) => { const c = u32(w); if (c !== null && (c & 0xFFF0) === 0xF060) log('WM_SYSCOMMAND SC_CLOSE lParam', u32(l), where()); });
    win.hookWindowMessage(0x0011, () => log('WM_QUERYENDSESSION'));
    win.hookWindowMessage(0x0016, (w, l) => log('WM_ENDSESSION', u32(w), u32(l)));
    app.on('session-end', e => log('session-end', JSON.stringify(e && e.reasons)));
    for (const sig of ['SIGHUP', 'SIGINT', 'SIGBREAK', 'SIGTERM']) process.on(sig, () => log('signal', sig));
    win.on('close', () => { let alive = true; try { process.kill(process.ppid, 0); } catch (e) { alive = e.code === 'EPERM'; }
      log('close detail', JSON.stringify({ pid: process.pid, ppid: process.ppid, ppidAlive: alive })); });
    const fdType = fd => { try { const st = fs.fstatSync(fd); return st.isFIFO() ? 'pipe' : st.isFile() ? 'file' : st.isCharacterDevice() ? 'char' : 'other'; } catch (e) { return 'none'; } };
    log('stdio', JSON.stringify({ pid: process.pid, ppid: process.ppid, stdinTTY: !!process.stdin.isTTY, fds: [0, 1, 2].map(fdType), env: { CLAUDECODE: process.env.CLAUDECODE || '', CHILD: process.env.CLAUDE_CODE_CHILD_SESSION || '' } }));
  }
  win.on('focus', () => win.flashFrame(false));
  win.webContents.on('render-process-gone', (_e, d) => log('renderer gone', JSON.stringify(d)));
  log('window up', app.getVersion(), 'electron', process.versions.electron);
  startUpdater();
});
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('window-all-closed', () => { log('window-all-closed'); app.quit(); });
app.on('child-process-gone', (_e, d) => log('child process gone', JSON.stringify(d)));
app.on('before-quit', () => {
  if (quitting) return;
  quitting = true;
  log('quit: killing', [...pc.procs.values()].filter(r => !r.exited).length, 'pc sessions');
  pc.killAll();
  laptop.disconnect();
  // the resumed session shows idle until its next prompt, instead of a stale done tick
  if (C.TAGS) for (const s of state.sessions) if (s.machine === 'pc' && s.tag) { try { fs.unlinkSync(path.join(C.TAGS, s.tag + '.state')); } catch { /* none */ } }
  stateMod.saveNow(state);
});
