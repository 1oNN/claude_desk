const fs = require('fs');
const path = require('path');
const { STATE_DIR } = require('./consts');

const FILE = path.join(STATE_DIR, 'desk.json');

function load() {
  let s = {};
  try { s = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { s = {}; }
  s.extraProjects = s.extraProjects || [];
  s.sessions = s.sessions || [];
  s.ui = s.ui || {};
  s.ui.views = s.ui.views || {};
  return s;
}

let timer = null;
function save(state) {
  // coalesce bursts (every poll may touch a sid); write atomically so a crash never leaves half a file
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    fs.mkdirSync(STATE_DIR, { recursive: true });
    const out = {
      extraProjects: state.extraProjects,
      sessions: state.sessions.map(s => ({ id: s.id, machine: s.machine, project: s.project, account: s.account, kind: s.kind, name: s.name, sid: s.sid, cwd: s.cwd, tag: s.tag, order: s.order })),
      ui: state.ui,
    };
    const tmp = FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(out, null, 2));
    fs.renameSync(tmp, FILE);
  }, 200);
}

function saveNow(state) {
  if (timer) { clearTimeout(timer); timer = null; }
  save(state);
  if (timer) { clearTimeout(timer); timer = null; }
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const out = {
    extraProjects: state.extraProjects,
    sessions: state.sessions.map(s => ({ id: s.id, machine: s.machine, project: s.project, account: s.account, kind: s.kind, name: s.name, sid: s.sid, cwd: s.cwd, tag: s.tag, order: s.order })),
    ui: state.ui,
  };
  fs.writeFileSync(FILE, JSON.stringify(out, null, 2));
}

module.exports = { load, save, saveNow, FILE };
