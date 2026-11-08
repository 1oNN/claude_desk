// Alliance mode only: one line per Claude session saying what it is doing now, from Haiku every 10 minutes when the transcript grew.
const fs = require('fs');
const { execFile } = require('child_process');
const C = require('./consts');

const EVERY_MS = 10 * 60 * 1000;
const TAIL = 256 * 1024;
const MODEL = 'claude-haiku-5-5';
const SYSTEM = 'You label a Claude Code session for a sidebar. Reply with one line, at most 8 words, saying what the session is doing right now, or what it just finished if the last message from Claude ended the turn. Plain words, no quotes, no dashes, no full stop.';
const BACKOFF_MS = 10 * 60 * 1000;

const clip = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 3) + '...' : s; };

// the newest typed ask, then the last few things Claude said or ran, newest last
function digest(text, max = 2500) {
  const out = [];
  let ask = null;
  for (const line of text.split('\n')) {
    if (!/"type":"(user|assistant)"/.test(line)) continue;
    let r; try { r = JSON.parse(line); } catch { continue; }
    if (r.isSidechain || r.isMeta || r.isCompactSummary) continue;
    const c = r.message && r.message.content;
    if (r.type === 'user') {
      if (typeof c === 'string' && c.trim() && !c.trimStart().startsWith('<')) { ask = clip(c, 400); out.push('USER: ' + clip(c, 200)); }
      continue;
    }
    for (const b of Array.isArray(c) ? c : []) {
      if (b.type === 'text' && b.text.trim()) out.push('CLAUDE: ' + clip(b.text, 200));
      else if (b.type === 'tool_use') { const i = b.input || {}; out.push(`TOOL ${b.name}: ` + clip(i.description || i.file_path || i.pattern || i.command || i.prompt || '', 120)); }
    }
  }
  let body = out.slice(-14).join('\n');
  if (body.length > max) body = body.slice(-max);
  return ask ? `Last request from the person: ${ask}\n\nRecent activity, newest last:\n${body}` : body;
}

function clean(s) {
  s = String(s || '').split('\n').map(x => x.trim()).filter(Boolean)[0] || '';
  return clip(s.replace(/[\u2014\u2013]/g, ',').replace(/^["'`]+|["'`.]+$/g, ''), 70);
}

function readTail(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size, n = Math.min(size, TAIL);
    const buf = Buffer.alloc(n); fs.readSync(fd, buf, 0, n, size - n);
    const t = buf.toString('utf8');
    return n < size ? t.slice(t.indexOf('\n') + 1) : t;
  } finally { fs.closeSync(fd); }
}

class OneLiner {
  // sessions(): [{ id, account, transcript }] for live Claude sessions on this PC; envFor(account) is the session's env
  constructor({ sessions, envFor, log, onLine }) {
    this.sessions = sessions; this.envFor = envFor; this.log = log || (() => {}); this.onLine = onLine || (() => {});
    this.seen = new Map(); // id -> transcript size at the last call
    this.lines = new Map(); // id -> line
    this.pauseUntil = new Map(); // account -> ms
    this.busy = false;
    this.calls = 0; this.costUsd = 0;
  }

  start() { if (!this.timer) this.timer = setInterval(() => this.tick().catch(e => this.log('oneliner tick', e.message)), EVERY_MS); }
  line(id) { return this.lines.get(id) || null; }
  forget(id) { this.seen.delete(id); this.lines.delete(id); }

  async tick() {
    if (this.busy || !C.CLAUDE_EXE) return;
    this.busy = true;
    try {
      for (const s of this.sessions()) {
        if ((this.pauseUntil.get(s.account) || 0) > Date.now()) continue;
        let size; try { size = fs.statSync(s.transcript).size; } catch { continue; }
        if (this.seen.get(s.id) === size) continue;
        this.seen.set(s.id, size);
        const prompt = digest(readTail(s.transcript));
        if (!prompt.trim()) continue;
        const line = await this.ask(s, prompt);
        if (line && line !== this.lines.get(s.id)) { this.lines.set(s.id, line); this.onLine(s.id, line); }
      }
    } finally { this.busy = false; }
  }

  ask(s, prompt) {
    const env = { ...this.envFor(s.account) };
    delete env.DESK_ACCOUNT; delete env.DESK_STATUS_CHAIN;
    const args = ['-p', '--model', MODEL, '--system-prompt', SYSTEM, '--tools', '', '--setting-sources', '', '--settings', '{"disableAllHooks":true}',
      '--strict-mcp-config', '--disable-slash-commands', '--no-session-persistence', '--output-format', 'json'];
    return new Promise(resolve => {
      const p = execFile(C.CLAUDE_EXE, args, { env, cwd: C.STATE_DIR, windowsHide: true, timeout: 60000, maxBuffer: 1 << 20 }, (err, so) => {
        let d = null; try { d = JSON.parse(so); } catch { /* not json */ }
        if (err || !d || d.is_error) {
          this.pauseUntil.set(s.account, Date.now() + BACKOFF_MS);
          this.log('oneliner failed', s.account, clip(err ? err.message : d ? d.result : so, 160));
          return resolve(null);
        }
        this.calls++; this.costUsd += d.total_cost_usd || 0;
        const u = d.usage || {};
        this.log('oneliner', s.account, `in ${(u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0)} out ${u.output_tokens || 0} list $${(d.total_cost_usd || 0).toFixed(5)}`, `total ${this.calls} $${this.costUsd.toFixed(4)}`);
        resolve(clean(d.result));
      });
      p.stdin.end(prompt);
    });
  }
}

module.exports = { OneLiner, digest, clean, EVERY_MS };
