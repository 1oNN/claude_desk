const fs = require('fs');
const path = require('path');
const { STATE_DIR } = require('./consts');

const FILE = path.join(STATE_DIR, 'desk.json');
// what each window keeps for itself; everything else in ui is an app-wide preference
const LAYOUT_KEYS = ['current', 'views', 'nav', 'sidebar', 'expanded'];

function migrate(s) {
  s.windows = Array.isArray(s.windows) ? s.windows.filter(w => w && typeof w === 'object') : [];
  // desk.json from 0.1 had one ui blob; its layout becomes window 1
  if (!s.windows.length) {
    const w = { wid: 1 };
    for (const k of LAYOUT_KEYS) if (k in s.ui) w[k] = s.ui[k];
    s.windows.push(w);
  }
  for (const k of LAYOUT_KEYS) delete s.ui[k];
  s.windows.forEach((w, i) => { w.wid = i + 1; w.views = w.views && typeof w.views === 'object' ? w.views : {}; });
  return s;
}

function load() {
  let s = {};
  try { s = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { s = {}; }
  s.extraProjects = s.extraProjects || [];
  s.sessions = s.sessions || [];
  s.ui = s.ui && typeof s.ui === 'object' ? s.ui : {};
  return migrate(s);
}

function shape(state) {
  return {
    extraProjects: state.extraProjects,
    sessions: state.sessions.map(s => ({ id: s.id, machine: s.machine, project: s.project, account: s.account, kind: s.kind, name: s.name, sid: s.sid, cwd: s.cwd, tag: s.tag, order: s.order })),
    ui: state.ui,
    windows: state.windows,
  };
}

let timer = null;
function save(state) {
  // coalesce bursts (every poll may touch a sid); write atomically so a crash never leaves half a file
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    fs.mkdirSync(STATE_DIR, { recursive: true });
    const tmp = FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(shape(state), null, 2));
    fs.renameSync(tmp, FILE);
  }, 200);
}

function saveNow(state) {
  if (timer) { clearTimeout(timer); timer = null; }
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(shape(state), null, 2));
}

// a renderer sends its whole ui; preferences go to state.ui, layout to its own window record
function mergeUi(state, wid, ui) {
  const rec = state.windows.find(w => w.wid === wid);
  const prefsBefore = JSON.stringify(state.ui);
  for (const [k, v] of Object.entries(ui)) {
    if (LAYOUT_KEYS.includes(k)) { if (rec) rec[k] = v; } else state.ui[k] = v;
  }
  return JSON.stringify(state.ui) !== prefsBefore;
}

// the ui a window starts from: the app-wide preferences with its own layout on top
function uiFor(state, wid) {
  const rec = state.windows.find(w => w.wid === wid) || {};
  const out = { ...state.ui };
  for (const k of LAYOUT_KEYS) if (k in rec) out[k] = rec[k];
  return out;
}

// a new project folder name: one plain segment, nothing Windows reserves, not already there
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;
function checkProjectName(name, root) {
  name = typeof name === 'string' ? name.trim() : '';
  if (!name) return 'Give the project a name';
  if (name.length > 80) return 'That name is too long';
  if (/[<>:"/\\|?*\x00-\x1f]/.test(name)) return 'A name cannot hold < > : " / \\ | ? or *';
  if (name === '.' || name === '..' || /[. ]$/.test(name)) return 'A name cannot end in a dot or a space';
  if (RESERVED.test(name)) return `${name} is a name Windows keeps for itself`;
  if (!root) return 'Set a projects folder in Settings first';
  if (fs.existsSync(path.join(root, name))) return `${name} already exists in ${root}`;
  return null;
}

module.exports = { load, save, saveNow, migrate, mergeUi, uiFor, checkProjectName, LAYOUT_KEYS, FILE };
