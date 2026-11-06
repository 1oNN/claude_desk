// PC sessions: one node-pty per session, claude.exe spawned directly so pty.pid is the pid in the registry.
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');
const pty = require('node-pty');
const C = require('./consts');
const alliance = require('./alliance');
const accounts = require('./accounts');
const usage = require('./usage');

const RING_MAX = 128 * 1024;

class PcSessions extends EventEmitter {
  constructor(log) {
    super();
    this.log = log || (() => {});
    this.procs = new Map(); // session id -> { pty, pid, ring, ringSize, exited, startedAt }
    this.queue = [];
    this.draining = false;
    this.size = { cols: 120, rows: 30 };
  }

  setDefaultSize(cols, rows) { if (cols > 0 && rows > 0) this.size = { cols, rows }; }

  baseEnv(account) {
    const env = { ...process.env };
    // Desk may itself be launched from inside a claude session; none of that may leak into the children
    for (const k of Object.keys(env)) if (/^(CLAUDE|TERM_PROGRAM)/i.test(k)) delete env[k];
    Object.assign(env, { TERM: 'xterm-256color', COLORTERM: 'truecolor', CLAUDE_CODE_DISABLE_TERMINAL_TITLE: '1', CLAUDE_CODE_ALT_SCREEN_FULL_REPAINT: '1' });
    const a = account ? accounts.get(account) : null;
    if (a && a.configDir) env.CLAUDE_CONFIG_DIR = a.configDir;
    else if (process.env.CLAUDE_CONFIG_DIR) env.CLAUDE_CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR;
    // the status line script files its numbers under this account
    if (account) env.DESK_ACCOUNT = String(account);
    return env;
  }

  enqueue(session, opts) {
    if (this.queue.some(q => q.session.id === session.id)) return;
    this.queue.push({ session, opts: opts || {} });
    this.emit('status', session.id, 'queued');
    this.drain();
  }

  async drain() {
    if (this.draining) return;
    this.draining = true;
    while (this.queue.length) {
      const { session, opts } = this.queue.shift();
      try {
        await this.start(session, opts);
        if (session.kind !== 'shell') await this.waitRegistered(session.id, 5000);
      } catch (e) {
        this.log('start-error', session.name, e.message);
        this.emit('error', session.id, e.message);
      }
    }
    this.draining = false;
  }

  waitRegistered(id, ms) {
    const rec = this.procs.get(id);
    if (!rec) return Promise.resolve();
    const file = path.join(accounts.configDir(rec.account), 'sessions', rec.pid + '.json');
    const until = Date.now() + ms;
    return new Promise(resolve => {
      const tick = () => {
        if (rec.exited || fs.existsSync(file) || Date.now() > until) return resolve();
        setTimeout(tick, 250);
      };
      tick();
    });
  }

  async start(session, { resume, peers } = {}) {
    if (!fs.existsSync(session.cwd)) throw new Error(`folder missing: ${session.cwd}`);
    const old = this.procs.get(session.id);
    if (old && !old.exited) throw new Error(`${session.name} is already running`);
    this.emit('status', session.id, 'starting');
    let file, args, env;
    if (session.kind === 'shell') {
      if (!C.PWSH) throw new Error('no PowerShell found; set its path in Settings');
      file = C.PWSH; args = ['-NoLogo']; env = this.baseEnv(0);
    } else {
      if (!C.CLAUDE_EXE) throw new Error('Claude Code was not found; set its path in Settings');
      const prompt = await alliance.getPrompt({ account: session.account, name: session.name, project: session.cwd, peers: peers || [] });
      env = this.baseEnv(session.account);
      if (C.ALLIANCE) { env.CLAUDE_ALLIANCE_NAME = session.name; env.CLAUDE_ALLIANCE_TAG = session.tag; }
      file = C.CLAUDE_EXE;
      args = ['-n', session.name];
      const sl = usage.settingsArg(session.account);
      if (sl) args.push('--settings', sl);
      const canResume = resume && alliance.transcriptExists(session.account, session.cwd, session.sid);
      args.push(canResume ? '--resume' : '--session-id', session.sid);
      if (prompt) args.push('--append-system-prompt', prompt);
      if (canResume && (C.ALLIANCE || C.CARRY) && alliance.isInterrupted(session.account, session.cwd, session.sid)) args.push(C.CARRY_ON);
    }
    const { cols, rows } = this.size;
    this.log('spawn', session.name, file, JSON.stringify(args.map(a => a.length > 80 ? a.slice(0, 77) + '...' : a)), session.cwd);
    const p = pty.spawn(file, args, { name: 'xterm-256color', cols, rows, cwd: session.cwd, env });
    const rec = { pty: p, pid: p.pid, account: session.account, ring: [], ringSize: 0, exited: null, startedAt: Date.now(), cols, rows };
    this.procs.set(session.id, rec);
    p.onData(d => {
      rec.ring.push(d); rec.ringSize += d.length;
      while (rec.ringSize > RING_MAX && rec.ring.length > 1) rec.ringSize -= rec.ring.shift().length;
      this.emit('data', session.id, d);
    });
    p.onExit(e => {
      rec.exited = e;
      this.log('exit', session.name, JSON.stringify(e));
      this.emit('exit', session.id, e);
    });
    this.emit('status', session.id, 'live');
    return p.pid;
  }

  write(id, data) { const r = this.procs.get(id); if (r && !r.exited) r.pty.write(data); }

  resize(id, cols, rows) {
    const r = this.procs.get(id);
    if (!r || r.exited || !(cols > 0) || !(rows > 0)) return;
    try { r.pty.resize(cols, rows); r.cols = cols; r.rows = rows; } catch (e) { this.log('resize-error', id, e.message); }
  }

  // node-pty 1.1.0 has no guard: a second kill() before exit calls ClosePseudoConsole on a freed handle (0xc0000374)
  killRec(r) {
    if (!r || r.exited || r.killed) return;
    r.killed = true;
    try { r.pty.kill(); } catch { /* gone */ }
  }

  kill(id) { this.killRec(this.procs.get(id)); }
  replay(id) { const r = this.procs.get(id); return r ? r.ring.join('') : ''; }
  pid(id) { const r = this.procs.get(id); return r && !r.exited ? r.pid : null; }
  record(id) { return this.procs.get(id); }
  isLive(id) { const r = this.procs.get(id); return !!(r && !r.exited); }
  drop(id) { this.kill(id); this.procs.delete(id); }

  killAll() {
    for (const r of this.procs.values()) this.killRec(r);
  }
}

module.exports = { PcSessions };
