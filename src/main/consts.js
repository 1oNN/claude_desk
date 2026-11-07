// Paths and constants. Everything that depends on the machine is resolved here, in this order:
// env (DESK_*), then <state>/settings.json, then discovery. The multi-account "alliance" mode is
// only on when allianceRoot (or DESK_ALLIANCE_ROOT) names a folder holding desk-prompt.ps1.
const fs = require('fs');
const path = require('path');
const os = require('os');

const HOME = os.homedir();
const APPDATA = process.env.APPDATA || path.join(HOME, 'AppData', 'Roaming');
const LOCALAPPDATA = process.env.LOCALAPPDATA || path.join(HOME, 'AppData', 'Local');
// an installed build keeps its state in the user profile; a checkout keeps it next to the code
function packaged() { try { const { app } = require('electron'); return !!(app && app.isPackaged); } catch { return false; } }
function userData() { try { return require('electron').app.getPath('userData'); } catch { return null; } }
const STATE_DIR = process.env.DESK_STATE_DIR || (packaged() && userData()) || path.join(__dirname, '..', '..', 'state');
const SETTINGS_FILE = path.join(STATE_DIR, 'settings.json');

function exists(p) { try { return !!p && fs.existsSync(p); } catch { return false; } }
function isFile(p) { try { return !!p && fs.statSync(p).isFile(); } catch { return false; } }
function isDir(p) { try { return !!p && fs.statSync(p).isDirectory(); } catch { return false; } }
function norm(p) { return p ? path.normalize(p) : null; }
function first(cands, test) { for (const c of cands) if (test(c)) return c; return null; }

function onPath(names) {
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const d of dirs) for (const n of names) { const p = path.join(d, n); if (isFile(p)) return p; }
  return null;
}

function readSettings() {
  try { const s = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); return s && typeof s === 'object' ? s : {}; } catch { return {}; }
}

function writeSettings(patch) {
  const cur = readSettings();
  for (const [k, v] of Object.entries(patch || {})) { if (v == null || v === '') delete cur[k]; else cur[k] = v; }
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const tmp = SETTINGS_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cur, null, 2));
  fs.renameSync(tmp, SETTINGS_FILE);
  resolve();
  return cur;
}

// claude on the PC is an npm shim; the real exe is wanted so pty.pid is the claude pid the registry files are named after
function findClaude(settings) {
  const cands = [
    process.env.DESK_CLAUDE, settings.claudeExe,
    path.join(APPDATA, 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'),
    path.join(HOME, '.local', 'bin', 'claude.exe'),
    path.join(LOCALAPPDATA, 'Programs', 'claude', 'claude.exe'),
  ];
  const found = first(cands, p => isFile(p) && /^claude\.exe$/i.test(path.basename(p))) || onPath(['claude.exe']);
  if (found) return found;
  // only the npm shim is on PATH: use the exe it wraps, never the .cmd (cmd.exe would reparse every argument)
  const cmd = onPath(['claude.cmd']);
  const behind = cmd && path.join(path.dirname(cmd), 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
  return isFile(behind) ? behind : null;
}

function findPwsh(settings) {
  const cands = [
    process.env.DESK_PWSH, settings.pwsh,
    'C:/Program Files/PowerShell/7/pwsh.exe',
    path.join(LOCALAPPDATA, 'Microsoft', 'WindowsApps', 'pwsh.exe'),
  ];
  return first(cands, isFile) || onPath(['pwsh.exe']) || first([path.join(process.env.SystemRoot || 'C:/Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')], isFile);
}

function findProjects(settings) {
  const cands = [
    process.env.DESK_PROJECTS, settings.projectsRoot,
    path.join(HOME, 'Projects'), path.join(HOME, 'projects'), path.join(HOME, 'source', 'repos'),
    path.join(HOME, 'code'), path.join(HOME, 'dev'), path.join(HOME, 'src'),
  ];
  return norm(first(cands, isDir));
}

const C = {
  CLAUDE_HOME: path.join(HOME, '.claude'),
  STATE_DIR,
  SETTINGS_FILE,
  COLOURS: { 0: '#9A9A9A', 1: '#8FD694', 2: '#8ED3D9', 3: '#F2C77A', 4: '#D7A6E8', 5: '#FF8A9B', 6: '#9AB8F5' },
  // sent on resume only when carryOn is set; a resumed transcript already shows the cut-off work
  CARRY_ON: 'Claude Desk restarted while you were working. Carry on, and re-run any command that was cut off.',
  POLL_PC_MS: 2000,
  POLL_LAPTOP_MS: 4000,
  MEMORY_MS: 30000,
  // every CIM pass spawns a 90 MB pwsh for about a second; while per-session memory is hidden only every fourth tick runs, for the status bar total
  MEMORY_IDLE_TICKS: 4,
  readSettings,
  writeSettings,
  resolve,
};

function resolve() {
  const s = readSettings();
  // never guessed: a script found by looking around would run in every session's start
  const root = process.env.DESK_ALLIANCE_ROOT || s.allianceRoot || null;
  const prompt = root ? path.join(root, 'desk-prompt.ps1') : null;
  C.ALLIANCE = !!root && isFile(prompt) && s.alliance !== false;
  C.ALLIANCE_ROOT = C.ALLIANCE ? path.normalize(root) : null;
  C.DESK_PROMPT = C.ALLIANCE ? prompt : null;
  C.TAGS = C.ALLIANCE ? path.join(root, 'shared', 'status', 'tags') : null;
  C.STATUS = C.ALLIANCE ? path.join(root, 'shared', 'status') : null;
  C.CLAUDE_EXE = norm(findClaude(s));
  C.PWSH = norm(findPwsh(s));
  C.PROJECTS_ROOT = findProjects(s);
  C.ROLES = s.roles && typeof s.roles === 'object' ? s.roles : {};
  // a second copy (a checkout next to an installed build) can take its own name, which also gives it its own profile and lock
  C.APP_NAME = typeof s.appName === 'string' && s.appName.trim() ? s.appName.trim().slice(0, 40) : 'Claude Desk';
  C.SETTINGS = s;
  // the remote machine: a Host from ~/.ssh/config. Unset means Desk has no remote machine at all
  C.REMOTE_HOST = typeof s.remoteHost === 'string' && /^[A-Za-z0-9._-]{1,64}$/.test(s.remoteHost) ? s.remoteHost : null;
  // 'alliance' starts remote sessions through ~/Claude/alliance.sh; anything else runs plain claude in tmux
  C.REMOTE_ALLIANCE = s.remoteLaunch === 'alliance';
  // the remote projects folder, under the remote home
  C.REMOTE_PROJECTS = typeof s.remoteProjects === 'string' && /^[A-Za-z0-9._/-]{1,120}$/.test(s.remoteProjects) && !s.remoteProjects.split('/').includes('..') ? s.remoteProjects.replace(/^\/+|\/+$/g, '') : 'projects';
  // which saved PC sessions start with Desk: 'current' (the panes of the project last shown), 'all', or 'none'; the rest wait with a Resume button
  C.RESUME = ['all', 'current', 'none'].includes(s.resume) ? s.resume : 'current';
  // 'off' paints with the CPU and drops the GPU process (about 100 MB on the bench); xterm uses the DOM renderer so it looks the same
  C.GPU = s.gpu === 'off' ? 'off' : 'on';
  // what Desk adds to a session's system prompt: nothing ('off', the default), its name, or its name and the other sessions in the project
  C.CONTEXT = ['name', 'team'].includes(s.context) ? s.context : 'off';
  C.CARRY = s.carryOn === true;
  return C;
}

function appVersion() { try { return require('electron').app.getVersion(); } catch { return require('../../package.json').version; } }
// what the renderer shows on the setup card and in Settings
C.setup = () => ({
  appName: C.APP_NAME, alliance: C.ALLIANCE, accounts: require('./accounts').ids(), firstRun: require('./accounts').isFirstRun(), claudeExe: C.CLAUDE_EXE, pwsh: C.PWSH, projectsRoot: C.PROJECTS_ROOT, resume: C.RESUME, gpu: C.GPU, context: C.CONTEXT, carryOn: C.CARRY, usage: C.SETTINGS.usage === 'off' ? 'off' : 'on', updates: C.SETTINGS.updates === 'off' ? 'off' : 'on', oneLiner: C.SETTINGS.oneLiner === 'off' ? 'off' : 'on', version: appVersion(),
  stateDir: C.STATE_DIR, settingsFile: C.SETTINGS_FILE, found: { claude: isFile(C.CLAUDE_EXE), pwsh: isFile(C.PWSH), projects: isDir(C.PROJECTS_ROOT) },
  env: { claude: !!process.env.DESK_CLAUDE, pwsh: !!process.env.DESK_PWSH, projects: !!process.env.DESK_PROJECTS },
});

resolve();
module.exports = C;
