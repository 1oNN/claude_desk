// The Claude Code accounts Desk can start sessions as. Each one is a config folder (CLAUDE_CONFIG_DIR); Desk never reads or stores a token.
const fs = require('fs');
const path = require('path');
const os = require('os');
const C = require('./consts');

const FILE = path.join(C.STATE_DIR, 'accounts.json');
const SHARED = ['skills', 'agents', 'commands', 'plugins'];
let list = null;
let firstRun = false;

const isHex = v => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
const text = (v, max) => typeof v === 'string' ? v.replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, max) : '';
function isDir(p) { try { return fs.statSync(p).isDirectory(); } catch { return false; } }
function palette(id) { return C.COLOURS[((id - 1) % 6) + 1]; }

function clean(a) {
  const id = Number(a && a.id);
  if (!Number.isInteger(id) || id < 1 || id > 999) return null;
  const configDir = typeof a.configDir === 'string' && path.isAbsolute(a.configDir) ? path.normalize(a.configDir) : null;
  return { id, name: text(a.name, 24) || `claude-${id}`, colour: isHex(a.colour) ? a.colour : palette(id), role: text(a.role, 40), configDir };
}

// what an owner of the older multi-account layout already has: account 1 in the default folder, 2 and up under <root>/accounts/claude-N
function seed() {
  if (!C.ALLIANCE) return [{ id: 1, name: 'Main', colour: palette(1), role: '', configDir: null }];
  return [1, 2, 3, 4, 5, 6].map(n => ({ id: n, name: `claude-${n}`, colour: C.COLOURS[n], role: text(C.ROLES[n], 40), configDir: n === 1 ? null : path.join(C.ALLIANCE_ROOT, 'accounts', `claude-${n}`) }));
}

function save() {
  fs.mkdirSync(C.STATE_DIR, { recursive: true });
  fs.writeFileSync(FILE + '.tmp', JSON.stringify(list, null, 2));
  fs.renameSync(FILE + '.tmp', FILE);
  firstRun = false;
}

function load() {
  let j = null;
  try { j = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { /* missing or broken */ }
  const got = Array.isArray(j) ? j.map(clean).filter(Boolean) : [];
  const seen = new Set();
  list = got.filter(a => !seen.has(a.id) && seen.add(a.id));
  if (list.length) { firstRun = false; return list; }
  list = seed();
  if (C.ALLIANCE) save(); else firstRun = true;
  return list;
}

function all() { return list || load(); }
function ids() { return all().map(a => a.id); }
function get(id) { return all().find(a => a.id === id) || null; }

function defaultDir() { return process.env.CLAUDE_CONFIG_DIR ? path.normalize(process.env.CLAUDE_CONFIG_DIR) : C.CLAUDE_HOME; }
function configDir(id) { const a = get(id); return (a && a.configDir) || defaultDir(); }
// with no CLAUDE_CONFIG_DIR, Claude Code keeps its account file next to the folder, not inside it
function stateFile(id) {
  const a = get(id);
  if (a && a.configDir) return path.join(a.configDir, '.claude.json');
  return process.env.CLAUDE_CONFIG_DIR ? path.join(defaultDir(), '.claude.json') : path.join(os.homedir(), '.claude.json');
}

const emailCache = new Map(); // file -> { mtime, email }
function emailOf(file) {
  let st;
  try { st = fs.statSync(file); } catch { return null; }
  const hit = emailCache.get(file);
  if (hit && hit.mtime === st.mtimeMs) return hit.email;
  let email = null;
  try { const o = JSON.parse(fs.readFileSync(file, 'utf8')).oauthAccount; email = o && typeof o.emailAddress === 'string' ? o.emailAddress : null; } catch { /* mid-write */ }
  emailCache.set(file, { mtime: st.mtimeMs, email });
  return email;
}

function status(id) {
  const dir = configDir(id);
  const creds = fs.existsSync(path.join(dir, '.credentials.json'));
  const email = emailOf(stateFile(id));
  return { signedIn: creds || !!email, email };
}

// for the renderer: the store plus sign-in state, never anything from the credentials file itself
function view() {
  return all().map(a => ({ ...a, dir: configDir(a.id), ...status(a.id) }));
}

// a new account starts with the main account's skills, agents, commands and plugins, as junctions (no admin needed)
function share(dir) {
  const from = defaultDir();
  for (const n of SHARED) {
    const src = path.join(from, n), dst = path.join(dir, n);
    if (!isDir(src) || fs.existsSync(dst)) continue;
    try { fs.symlinkSync(src, dst, 'junction'); } catch { /* leave it unshared */ }
  }
  const md = path.join(from, 'CLAUDE.md'), mdDst = path.join(dir, 'CLAUDE.md');
  if (fs.existsSync(md) && !fs.existsSync(mdDst)) { try { fs.linkSync(md, mdDst); } catch { /* another drive: skip */ } }
}

function add(opts = {}) {
  all();
  const id = list.reduce((m, a) => Math.max(m, a.id), 0) + 1;
  let configDir = null;
  if (opts.configDir) {
    if (typeof opts.configDir !== 'string' || !path.isAbsolute(opts.configDir) || !isDir(opts.configDir)) throw new Error('that folder does not exist');
    configDir = path.normalize(opts.configDir);
  } else {
    configDir = path.join(C.STATE_DIR, 'accounts', String(id));
    fs.mkdirSync(configDir, { recursive: true });
    if (opts.share !== false) share(configDir);
  }
  const a = clean({ id, name: opts.name, colour: opts.colour, role: opts.role, configDir });
  list.push(a);
  save();
  return a;
}

function update(id, patch = {}) {
  const a = get(id);
  if (!a) throw new Error('no such account');
  if ('name' in patch) a.name = text(patch.name, 24) || a.name;
  if ('colour' in patch && isHex(patch.colour)) a.colour = patch.colour;
  if ('role' in patch) a.role = text(patch.role, 40);
  save();
  return a;
}

// the folder stays on disk: it holds the sign-in and every transcript
function remove(id) {
  all();
  if (list.length < 2) throw new Error('Desk needs at least one account');
  if (!get(id)) throw new Error('no such account');
  list = list.filter(a => a.id !== id);
  save();
}

// the first-run setup ends with this, even when nothing was changed
function confirm() { all(); save(); }

module.exports = { load, all, ids, get, view, configDir, status, add, update, remove, confirm, isFirstRun: () => (all(), firstRun), FILE };
