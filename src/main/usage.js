// Usage and cost per account, from the status line Desk gives its own sessions (src/statusline.js). Costs no tokens.
const fs = require('fs');
const path = require('path');
const C = require('./consts');
const accounts = require('./accounts');

const DIR = path.join(C.STATE_DIR, 'statusline');
const STATUS = path.join(C.STATE_DIR, 'status');
const SETTINGS = path.join(DIR, 'settings.json');

// copied out of the app so the script runs from a plain folder even when Desk is packed in an asar
function install() {
  fs.mkdirSync(DIR, { recursive: true });
  fs.mkdirSync(STATUS, { recursive: true });
  fs.writeFileSync(path.join(DIR, 'statusline.js'), fs.readFileSync(path.join(__dirname, '..', 'statusline.js')));
  const cmd = path.join(DIR, 'desk-status.cmd');
  fs.writeFileSync(cmd, `@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${process.execPath}" "%~dp0statusline.js"\r\n`);
  fs.writeFileSync(SETTINGS, JSON.stringify({ statusLine: { type: 'command', command: `"${cmd}"`, padding: 0, refreshInterval: 30 } }));
  prune();
}

// a session's file is only worth keeping for the month it counts towards
function prune() {
  const cut = Date.now() / 1000 - 40 * 86400;
  let files = [];
  try { files = fs.readdirSync(STATUS).filter(f => f.endsWith('.json')); } catch { return; }
  for (const f of files) { try { const r = JSON.parse(fs.readFileSync(path.join(STATUS, f), 'utf8')); if ((r.t || 0) < cut) fs.unlinkSync(path.join(STATUS, f)); } catch { /* mid-write */ } }
}

// someone who already has a status line keeps it; that account then shows no usage in Desk
function ownStatusLine(account) {
  try { return !!JSON.parse(fs.readFileSync(path.join(accounts.configDir(account), 'settings.json'), 'utf8')).statusLine; } catch { return false; }
}

function settingsArg(account) {
  if (C.ALLIANCE || C.SETTINGS.usage === 'off' || ownStatusLine(account)) return null;
  return fs.existsSync(SETTINGS) ? SETTINGS : null;
}

// newest limits per account; cost only for accounts that never reported limits, since only API-key accounts pay per token
function read() {
  const v = {};
  let files = [];
  try { files = fs.readdirSync(STATUS).filter(f => f.endsWith('.json')); } catch { return v; }
  const d = new Date(), month0 = new Date(d.getFullYear(), d.getMonth(), 1).getTime() / 1000, now = Date.now() / 1000;
  const acc = new Map();
  for (const f of files) {
    let r;
    try { r = JSON.parse(fs.readFileSync(path.join(STATUS, f), 'utf8')); } catch { continue; }
    if (!Number.isInteger(r.account) || r.account < 1) continue;
    const a = acc.get(r.account) || { t: 0, limits: false, total: 0, live: 0, open: 0, sessions: 0 };
    if (r.five_hour != null || r.seven_day != null) {
      a.limits = true;
      if (r.t > a.t) Object.assign(a, { t: r.t, five_hour: r.five_hour, seven_day: r.seven_day, five_hour_reset: r.five_hour_reset, seven_day_reset: r.seven_day_reset });
    }
    if ((r.t || 0) >= month0) {
      const c = (r.base || 0) + (r.last || 0);
      a.total += c; a.sessions++;
      if (now - (r.t || 0) < 120) { a.live += c; a.open++; }
    }
    acc.set(r.account, a);
  }
  const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  for (const [n, a] of acc) {
    v[n] = a.limits
      ? { five_hour: a.five_hour ?? null, seven_day: a.seven_day ?? null, five_hour_reset: a.five_hour_reset ?? null, seven_day_reset: a.seven_day_reset ?? null, updated: a.t }
      : (a.total ? { cost: { month, total: a.total, live: a.live, open: a.open, sessions: a.sessions } } : undefined);
    if (!v[n]) delete v[n];
  }
  return v;
}

module.exports = { install, settingsArg, read, STATUS };
