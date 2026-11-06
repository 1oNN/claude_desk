// Laptop sessions live in tmux over one ssh2 connection; the app only attaches, so they outlive it.
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const EventEmitter = require('events');
const { Client } = require('ssh2');
const C = require('./consts');

const shq = s => "'" + String(s).replace(/'/g, "'\\''") + "'";
// a number that goes into a shell line unquoted
const int = (v, dflt) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n > 0 && n < 100000 ? n : dflt; };

function parseSshConfig(alias) {
  let text = '';
  try { text = fs.readFileSync(path.join(os.homedir(), '.ssh', 'config'), 'utf8'); } catch { return null; }
  let inBlock = false;
  const cfg = { port: 22 };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^(\S+)\s*=?\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase(), val = m[2].trim();
    if (key === 'host') { inBlock = val.split(/\s+/).includes(alias); continue; }
    if (!inBlock) continue;
    if (key === 'hostname') cfg.host = val;
    else if (key === 'user') cfg.username = val;
    else if (key === 'port') cfg.port = Number(val);
    else if (key === 'identityfile') cfg.identityFile = val.replace(/^~/, os.homedir());
    else if (key === 'hostkeyalias') cfg.hostKeyAlias = val;
    else if (key === 'stricthostkeychecking') cfg.strict = val.toLowerCase() !== 'no';
  }
  return cfg.host ? cfg : null;
}

// Host keys for this host from ~/.ssh/known_hosts, plain or hashed entries. ssh2 accepts any key by default.
// @revoked keys come back under `revoked`; @cert-authority lines are skipped (no certificate checking here).
function knownHostKeys(cfg, file) {
  let text = '';
  try { text = fs.readFileSync(file || path.join(os.homedir(), '.ssh', 'known_hosts'), 'utf8'); } catch { return { keys: [], revoked: [] }; }
  // like OpenSSH, a non-standard port only matches [host]:port entries
  const h = cfg.hostKeyAlias || cfg.host;
  const names = [cfg.port && cfg.port !== 22 ? `[${h}]:${cfg.port}` : h];
  const keys = [], revoked = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    let marker = null, body = line;
    if (line.startsWith('@')) { const sp = line.search(/\s/); if (sp < 0) continue; marker = line.slice(1, sp); body = line.slice(sp).trim(); }
    if (marker && marker !== 'revoked') continue;
    const parts = body.split(/\s+/);
    if (parts.length < 3) continue;
    const [hosts, , b64] = parts;
    let hit = false;
    if (hosts.startsWith('|1|')) {
      const [, , salt, hash] = hosts.split('|');
      hit = names.some(n => crypto.createHmac('sha1', Buffer.from(salt, 'base64')).update(n).digest('base64') === hash);
    } else {
      hit = hosts.split(',').some(h => names.includes(h));
    }
    if (hit) { try { (marker ? revoked : keys).push(Buffer.from(b64, 'base64')); } catch {} }
  }
  return { keys, revoked };
}

function hostVerifierFor(cfg, file) {
  if (cfg.strict === false) return () => true;
  return key => {
    const { keys, revoked } = knownHostKeys(cfg, file);
    if (revoked.some(k => k.equals(key))) { cfg.lastHostError = 'host key is marked @revoked in known_hosts'; return false; }
    if (!keys.length) { cfg.lastHostError = 'host key not in known_hosts; run ssh ' + C.REMOTE_HOST + ' once'; return false; }
    if (keys.some(k => k.equals(key))) { cfg.lastHostError = null; return true; }
    cfg.lastHostError = 'host key does not match known_hosts';
    return false;
  };
}

// Runs on the remote machine each poll: live registry entries, tag files (alliance only), tmux panes, process sizes, memory.
const pollScript = alliance => `
import json, os, glob, subprocess
home = os.path.expanduser('~')
TAGS = ${alliance ? "home + '/Claude/shared/status/tags'" : 'None'}
out = {'sessions': [], 'tags': {}, 'tmux': {}, 'ps': [], 'mem': {}}
seen = set()
for f in glob.glob(home + '/.claude/sessions/*.json') + glob.glob(home + '/.claude-desk/accounts/*/sessions/*.json'):
    try:
        e = json.load(open(f))
    except Exception:
        continue
    try:
        os.kill(int(e.get('pid')), 0)
    except Exception:
        continue
    if e.get('pid') in seen:
        continue
    seen.add(e.get('pid'))
    out['sessions'].append(e)
for f in (glob.glob(TAGS + '/*') if TAGS else []):
    name, ext = os.path.splitext(os.path.basename(f))
    try:
        t = open(f).read().strip()
    except Exception:
        continue
    d = out['tags'].setdefault(name, {})
    if ext == '.state':
        d['state'] = t
    elif ext == '.summary':
        d['summary'] = t
    elif ext == '.json':
        try:
            d['title'] = json.loads(t).get('title')
        except Exception:
            pass
try:
    r = subprocess.run(['tmux', 'list-panes', '-a', '-F', '#{session_name}\\t#{pane_dead}\\t#{pane_pid}\\t#{session_attached}'], capture_output=True, text=True)
    for line in r.stdout.splitlines():
        p = line.split('\\t')
        if len(p) >= 4:
            out['tmux'][p[0]] = {'dead': p[1] == '1', 'pid': int(p[2] or 0), 'attached': int(p[3] or 0)}
except Exception:
    pass
try:
    r = subprocess.run(['ps', '-eo', 'pid,ppid,rss'], capture_output=True, text=True)
    for line in r.stdout.splitlines()[1:]:
        p = line.split()
        if len(p) == 3:
            out['ps'].append([int(p[0]), int(p[1]), int(p[2])])
except Exception:
    pass
try:
    for line in open('/proc/meminfo'):
        k, v = line.split(':')
        if k in ('MemTotal', 'MemAvailable', 'SwapTotal', 'SwapFree'):
            out['mem'][k] = int(v.strip().split()[0]) // 1024
except Exception:
    pass
print(json.dumps(out))
`;

class Laptop extends EventEmitter {
  constructor(log) {
    super();
    this.log = log || (() => {});
    this.cfg = C.REMOTE_HOST ? parseSshConfig(C.REMOTE_HOST) : null;
    // test hook: DESK_LAPTOP_HOST=10.255.255.1 exercises offline mode without powering the laptop off
    if (this.cfg && process.env.DESK_LAPTOP_HOST) this.cfg.host = process.env.DESK_LAPTOP_HOST;
    // no Host entry means the laptop is not set up on this machine: the renderer hides it rather than showing it offline
    this.status = this.cfg ? 'offline' : 'off';
    this.error = this.cfg ? null : C.REMOTE_HOST ? `no Host ${C.REMOTE_HOST} in ~/.ssh/config` : 'no remote machine set';
    this.conn = null;
    this.home = null;
    this.projects = [];
    this.streams = new Map(); // session id -> ssh channel
    this.retryTimer = null;
    this.connecting = false;
    this.closedByUs = false;
  }

  connect() {
    if (!this.cfg || this.connecting || this.status === 'online') return;
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
    this.connecting = true;
    this.status = 'connecting';
    this.emit('status');
    const c = new Client();
    const opts = { host: this.cfg.host, port: this.cfg.port, username: this.cfg.username, keepaliveInterval: 15000, keepaliveCountMax: 2, readyTimeout: 10000, hostVerifier: hostVerifierFor(this.cfg) };
    try { if (this.cfg.identityFile) opts.privateKey = fs.readFileSync(this.cfg.identityFile); } catch (e) { this.error = 'key: ' + e.message; }
    c.on('ready', async () => {
      this.conn = c;
      this.connecting = false;
      this.closedByUs = false;
      try {
        this.home = (await this.exec('echo $HOME')).out.trim();
        await this.listProjects();
        this.status = 'online';
        this.error = null;
        this.log('laptop online', this.cfg.host, this.home);
        this.emit('status');
        this.emit('online');
      } catch (e) { this.fail('setup: ' + e.message); }
    });
    c.on('error', e => this.fail(this.cfg.lastHostError || e.message));
    c.on('close', () => this.fail('connection closed'));
    c.on('end', () => this.fail('connection ended'));
    c.connect(opts);
  }

  fail(msg) {
    const was = this.status;
    this.connecting = false;
    this.status = 'offline';
    this.error = msg;
    if (this.conn) { try { this.conn.end(); } catch { /* already */ } }
    this.conn = null;
    for (const [id, s] of this.streams) { try { s.close(); } catch { /* gone */ } this.emit('detached', id); }
    this.streams.clear();
    if (was !== 'offline') this.log('laptop offline:', msg);
    this.emit('status');
    if (!this.closedByUs && !this.retryTimer) this.retryTimer = setTimeout(() => { this.retryTimer = null; this.connect(); }, 30000);
  }

  disconnect() {
    this.closedByUs = true;
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
    for (const s of this.streams.values()) { try { s.close(); } catch { /* gone */ } }
    this.streams.clear();
    if (this.conn) { try { this.conn.end(); } catch { /* already */ } }
    this.conn = null;
    this.status = 'offline';
  }

  exec(cmd, { stdin, timeout = 20000 } = {}) {
    return new Promise((resolve, reject) => {
      if (!this.conn) return reject(new Error('laptop offline'));
      this.conn.exec(cmd, (err, stream) => {
        if (err) return reject(err);
        let out = '', errText = '';
        const timer = setTimeout(() => { try { stream.close(); } catch { /* ignore */ } reject(new Error('timeout: ' + cmd.slice(0, 60))); }, timeout);
        stream.on('data', d => { out += d.toString(); });
        stream.stderr.on('data', d => { errText += d.toString(); });
        stream.on('close', code => { clearTimeout(timer); resolve({ code, out, err: errText }); });
        if (stdin != null) stream.end(stdin);
      });
    });
  }

  async listProjects() {
    const r = await this.exec(`ls -d ~/${C.REMOTE_PROJECTS}/*/ 2>/dev/null`);
    this.projects = r.out.split('\n').map(s => s.trim().replace(/\/$/, '')).filter(Boolean);
    return this.projects;
  }

  async poll() {
    const r = await this.exec('python3 -', { stdin: pollScript(C.REMOTE_ALLIANCE), timeout: 15000 });
    const line = r.out.trim().split('\n').pop();
    return JSON.parse(line);
  }

  startCommand(session, { resume, peers, cols, rows }) {
    const n = session.name;
    const acc = int(session.account, 1), how = resume ? '--resume' : '--session-id';
    // account 1 is the remote's own ~/.claude; others get a folder each, signed in the first time they start
    const inner = C.REMOTE_ALLIANCE
      ? `source ~/Claude/alliance.sh; alliance_desk ${acc} ${shq(n)} ${shq(session.tag)} ${shq(session.cwd)} ${shq((peers || []).join(','))} ${how} ${shq(session.sid)}`
      : `${acc === 1 ? '' : `export CLAUDE_CONFIG_DIR="$HOME/.claude-desk/accounts/${acc}"; mkdir -p "$CLAUDE_CONFIG_DIR"; `}exec claude -n ${shq(n)} ${how} ${shq(session.sid)}`;
    const shell = `bash -lc ${shq(inner)}`;
    return `tmux kill-session -t ${shq(n)} 2>/dev/null; tmux new-session -d -s ${shq(n)} -x ${int(cols, 120)} -y ${int(rows, 30)} -c ${shq(session.cwd)} ${shq(shell)} && tmux set-option -t ${shq(n)} remain-on-exit on && tmux set-option -t ${shq(n)} mouse on && tmux set-option -t ${shq(n)} status off`;
  }

  async start(session, opts) {
    const cmd = this.startCommand(session, opts || {});
    this.log('laptop start', session.name, cmd.slice(0, 200));
    const r = await this.exec(cmd);
    if (r.code !== 0) throw new Error(`tmux start failed (${r.code}): ${r.err || r.out}`.trim());
  }

  async startShell(session, { cols, rows }) {
    const n = session.name;
    const cmd = `tmux kill-session -t ${shq(n)} 2>/dev/null; tmux new-session -d -s ${shq(n)} -x ${int(cols, 120)} -y ${int(rows, 30)} -c ${shq(session.cwd)} 'bash -l' && tmux set-option -t ${shq(n)} mouse on && tmux set-option -t ${shq(n)} status off`;
    const r = await this.exec(cmd);
    if (r.code !== 0) throw new Error(`tmux shell failed: ${r.err || r.out}`.trim());
  }

  attach(session, cols, rows) {
    return new Promise((resolve, reject) => {
      if (!this.conn) return reject(new Error('laptop offline'));
      const old = this.streams.get(session.id);
      if (old) return resolve(false);
      this.conn.exec(`tmux attach -t ${shq(session.name)}`, { pty: { term: 'xterm-256color', cols: cols || 120, rows: rows || 30, width: 0, height: 0 } }, (err, stream) => {
        if (err) return reject(err);
        this.streams.set(session.id, stream);
        stream.on('data', d => this.emit('data', session.id, d.toString('utf8')));
        stream.stderr.on('data', d => this.emit('data', session.id, d.toString('utf8')));
        stream.on('close', () => {
          if (this.streams.get(session.id) === stream) this.streams.delete(session.id);
          this.emit('detached', session.id);
        });
        resolve(true);
      });
    });
  }

  write(id, data) { const s = this.streams.get(id); if (s) s.write(data); }
  resize(id, cols, rows) { const s = this.streams.get(id); if (s && cols > 0 && rows > 0) { try { s.setWindow(rows, cols, 0, 0); } catch { /* closed */ } } }
  detach(id) { const s = this.streams.get(id); if (s) { try { s.close(); } catch { /* gone */ } this.streams.delete(id); } }
  isAttached(id) { return this.streams.has(id); }

  async sendKeys(name, text) {
    await this.exec(`tmux send-keys -t ${shq(name)} -l ${shq(text)} && sleep 0.3 && tmux send-keys -t ${shq(name)} Enter`);
  }

  async kill(name) { await this.exec(`tmux kill-session -t ${shq(name)} 2>/dev/null; true`); }

  async cleanup(name, tag, full) {
    if (!C.REMOTE_ALLIANCE) return;
    if (!/^[a-z0-9-]+-\d+[a-z]$/.test(name) || /^claude-\d+$/.test(name) || !/^[a-z0-9-]+$/.test(tag || '')) return;
    const files = [`~/Claude/shared/status/tags/${shq(tag + '.state')}`];
    if (full) files.push(`~/Claude/shared/status/tags/${shq(tag + '.summary')}`, `~/Claude/shared/status/tags/${shq(tag + '.json')}`, `~/Claude/shared/status/${shq(name + '.json')}`);
    try { await this.exec(`rm -f ${files.join(' ')}`); } catch { /* offline */ }
  }
}

module.exports = { Laptop, parseSshConfig, knownHostKeys, hostVerifierFor, shq, int, pollScript };
