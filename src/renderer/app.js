let snap = null;
let ui = { current: null, views: {}, expanded: {}, lastAccount: {}, nav: 'projects', theme: '', sidebar: { w: 300, collapsed: false, hidden: false }, showMem: false, picker: {}, flash: true, notify: false, uiScale: 1, termFont: 14, zoom: {}, termZoom: {} };
const NAVS = ['home', 'projects', 'attention', 'settings'];
let dragId = null;

const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
const sessionById = id => snap && snap.sessions.find(s => s.id === id);
const projectByKey = k => snap && snap.projects.find(p => p.key === k);
const currentProject = () => projectByKey(ui.current);

const MAXP = 8, EMPTY = () => Array(MAXP).fill(null);
function view(key) {
  if (!key) return { n: 1, slots: EMPTY(), focus: 0 };
  if (!ui.views[key]) ui.views[key] = { n: 1, slots: EMPTY(), focus: 0 };
  const v = ui.views[key];
  v.slots = (v.slots || []).concat(EMPTY()).slice(0, MAXP);
  v.n = Math.min(MAXP, Math.max(1, v.n || 1));
  v.focus = Math.min(v.n - 1, Math.max(0, v.focus || 0));
  return v;
}
const saveUi = () => desk.setUi(ui);

// toasts stack bottom right, newest last. Hover holds one, a click or Esc dismisses, the sixth pushes the oldest out.
const TOAST_MS = 7000, TOAST_MAX = 5;
function toast(msg, kind) {
  const box = $('#toasts');
  const live = [...box.children].filter(t => !t.dataset.out);
  while (live.length >= TOAST_MAX) dismissToast(live.shift());
  const t = document.createElement('div');
  t.className = 'toast ' + (kind || '');
  t.textContent = msg;
  let left = TOAST_MS, since = 0, timer = 0;
  const arm = () => { since = Date.now(); timer = setTimeout(() => dismissToast(t), left); };
  t.addEventListener('mouseenter', () => { clearTimeout(timer); left = Math.max(1500, left - (Date.now() - since)); t.classList.add('held'); });
  t.addEventListener('mouseleave', () => { t.classList.remove('held'); arm(); });
  t.addEventListener('click', () => dismissToast(t));
  t._stop = () => clearTimeout(timer);
  box.appendChild(t);
  t.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: Dom.ms('--t-enter'), easing: Dom.ease('--ease-enter') });
  arm();
  return t;
}
function dismissToast(t) {
  if (!t || t.dataset.out) return;
  t.dataset.out = '1'; t._stop();
  const a = t.animate([{ opacity: 1 }, { opacity: 0, transform: 'translateY(4px)' }], { duration: Dom.ms('--t-leave'), easing: Dom.ease('--ease-exit'), fill: 'forwards' });
  a.onfinish = () => t.remove();
}
function clearToasts() { for (const t of [...$('#toasts').children]) dismissToast(t); }

// ---------- rendering ----------
const H = {
  onProject: key => showProject(key),
  onToggle: (key, open) => { ui.expanded[key] = open; saveUi(); renderSidebar(); },
  onSession: s => { if (s.machine + ':' + s.project !== ui.current) showProject(s.machine + ':' + s.project); placeInFocused(s.id); },
  onNewSession: p => { showProject(p.key); newSession('claude'); },
  onStop: s => { if (confirm(`Stop ${s.name}? It can be resumed later from the sidebar.`)) desk.stopSession(s.id); },
  onForget: s => { if (confirm(`Forget ${s.name}? Its tag and status files are removed. The transcript stays on disk.`)) forget(s.id); },
  onResume: s => desk.resumeSession(s.id),
  onAddProject: async machine => {
    if (machine === 'laptop') { openPalette('folder'); return; }
    await desk.addProject(machine, null);
  },
  onReconnect: () => desk.laptopReconnect(),
  onPicker: (machine, open) => { ui.picker[machine] = open; saveUi(); renderSidebar(); },
  onPick: key => { const p = projectByKey(key); if (p) ui.picker[p.machine] = false; showProject(key); },
};

function renderSidebar(force) { if (snap) Sidebar.render(snap, ui, H, force); }

function renderAll() {
  renderSidebar();
  renderTabs();
  renderProjbar();
  renderPaneHeads();
  renderAccount();
  renderShell();
  renderStatus();
  renderHome();
  renderPalette();
}

// ---------- shell: activity bar, sidebar width, status bar, home ----------
const ATTN = s => s.status === 'live' && (s.state === 'waiting' || s.glyph === 'failed');
const STATE_WORD = Sidebar.WORD;
function stateOf(s) {
  if (s.status !== 'live') return s.status === 'starting' || s.status === 'queued' ? 'starting' : s.status;
  if (s.kind === 'shell') return 'shell';
  if (s.glyph === 'failed') return 'failed';
  return s.state || 'idle';
}
const STATE_COLOUR = { working: 'working', waiting: 'waiting', finished: 'finished', failed: 'failed', starting: 'starting', elsewhere: 'elsewhere', offline: 'offline', shell: 'shell', exited: 'exited', stopped: 'exited', idle: 'idle' };

function renderShell() {
  const nav = NAVS.includes(ui.nav) ? ui.nav : 'projects';
  for (const b of $$('#activity .act')) { b.classList.toggle('on', b.dataset.nav === nav); Dom.attr(b, 'aria-current', b.dataset.nav === nav ? 'page' : null); }
  $('#home').hidden = !(nav === 'home' || nav === 'attention' || !ui.current);
  $('#sidebar-scroll').hidden = nav === 'settings';
  $('#settings').hidden = nav !== 'settings';
  for (const b of $$('#theme-seg button')) b.classList.toggle('on', b.dataset.theme === (ui.theme || ''));
  for (const b of $$('#scale-seg button')) b.classList.toggle('on', Number(b.dataset.scale) === (ui.uiScale || 1));
  renderZoom();
  applyZoom();
  for (const b of $$('#tfont-seg button')) b.classList.toggle('on', Number(b.dataset.font) === (ui.termFont || 14));
  renderAttentionSettings();
  if (!$('#settings').hidden) renderSetup();
  const app = $('#app');
  app.classList.toggle('sb-collapsed', !!ui.sidebar.collapsed);
  app.classList.toggle('sb-hidden', !!ui.sidebar.hidden);
  const pb = $('#panel-btn'), hid = !!ui.sidebar.hidden, pt = hid ? 'Show the left panel (Ctrl+Shift+B)' : 'Hide the left panel (Ctrl+Shift+B)';
  pb.classList.toggle('on', hid); Dom.attr(pb, 'aria-pressed', String(hid)); Dom.attr(pb, 'title', pt); Dom.attr(pb, 'aria-label', pt.replace(/ \(.*$/, ''));
  renderMemToggle();
  const w = ui.sidebar.w + 'px';
  if (app.style.getPropertyValue('--sidebar-w') !== w) app.style.setProperty('--sidebar-w', w);
  const sash = $('#sash'); Dom.attr(sash, 'aria-valuenow', String(ui.sidebar.w)); Dom.attr(sash, 'aria-valuemin', '220'); Dom.attr(sash, 'aria-valuemax', '480');
}

function renderStatus() {
  const live = snap.sessions.filter(s => s.status === 'live');
  const working = live.filter(s => s.state === 'working').length;
  const attn = snap.sessions.filter(ATTN).length;
  Dom.text($('#st-pc'), Sidebar.fmtMem(snap.totals.pc) || 'not measured');
  const L = snap.laptop, lap = $('#st-laptop');
  lap.hidden = L.status === 'off';
  const free = L.mem && L.mem.MemAvailable != null ? `${Math.round(L.mem.MemAvailable / 1024 * 10) / 10} GB free` : '';
  Dom.text(lap.lastElementChild, L.status === 'online' ? (free || 'online') : L.status);
  Dom.attr(lap, 'title', L.status !== 'online' && L.error ? L.error : null);
  lap.classList.toggle('off', L.status !== 'online');
  Dom.text($('#st-count'), `${live.length} session${live.length === 1 ? '' : 's'}, ${working} working`);
  const a = $('#st-attn');
  a.classList.toggle('attn', attn > 0);
  Dom.text(a, attn ? `${attn} need${attn === 1 ? 's' : ''} you` : 'nothing waiting');
  const badge = $('#attn-badge');
  badge.hidden = !attn; Dom.text(badge, attn ? String(attn) : '');
  const nm = (snap.setup && snap.setup.appName) || 'Claude Desk';
  const title = attn ? `(${attn}) ${nm}` : nm;
  if (document.title !== title) document.title = title;
  renderAge();
}
function renderAge() {
  if (!snap) return;
  const age = Math.max(0, Math.round((Date.now() - snap.now) / 1000));
  const el = $('#st-age');
  Dom.text(el, `snapshot ${age} s ago`);
  el.classList.toggle('stale', age > 10);
  const now = Date.now();
  for (const r of $$('#home .row[data-since]')) Dom.text(r.lastChild, fmtAge(now - Number(r.dataset.since)));
}
setInterval(renderAge, 1000);
function fmtAge(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d} d ${h % 24} h` : `${d} d`;
}


// home setup card: what Desk found on this PC; shown while something is missing or there is nothing to show yet
let lastSetupSig = '';
function renderSetupCard() {
  const box = $('#home-setup');
  const su = snap.setup;
  const show = !!su && ui.nav !== 'attention' && (!su.claudeExe || !su.pwsh || !snap.sessions.length);
  box.hidden = !show;
  if (!show) { lastSetupSig = ''; return; }
  const sig = JSON.stringify([su.claudeExe, su.pwsh, su.projectsRoot, su.firstRun, snap.sessions.length, (snap.accountList || []).map(a => a.signedIn)]);
  if (sig === lastSetupSig) return;
  lastSetupSig = sig;
  box.textContent = '';
  box.appendChild(Dom.h('h2', null, su.claudeExe ? 'Ready to start' : 'Claude Code was not found'));
  const dl = Dom.h('dl', 'setup-dl');
  const row = (k, v, ok) => { dl.appendChild(Dom.h('dt', null, k)); dl.appendChild(Dom.h('dd', ok ? 'ok' : 'bad', v)); };
  row('Claude Code', su.claudeExe || 'not found. Install it, or point Desk at claude.exe in Settings', !!su.claudeExe);
  row('Shell', su.pwsh || 'no PowerShell found', !!su.pwsh);
  row('Projects', su.projectsRoot || 'no folder set. Any folder can still be added from the sidebar', !!su.projectsRoot);
  const al = snap.accountList || [], signed = al.filter(a => a.signedIn).length;
  row('Accounts', `${al.length} (${signed} signed in)`, signed > 0);
  box.appendChild(dl);
  const btns = Dom.h('div', 'btns');
  if (su.firstRun || Welcome.isAway()) { const b0 = Dom.h('button', null, 'Continue setup'); b0.onclick = () => Welcome.resume(); btns.appendChild(b0); }
  const b1 = Dom.h('button', null, 'Open Settings'); b1.onclick = () => showNav('settings'); btns.appendChild(b1);
  if (su.claudeExe) { const b2 = Dom.h('button', 'primary', 'Pick a folder and start'); b2.onclick = () => desk.addProject('pc', null); btns.appendChild(b2); }
  box.appendChild(btns);
  box.appendChild(Dom.h('p', 'hint', 'Ctrl+K opens the command palette. Ctrl+/ shows every key.'));
}

let lastHomeSig = '';
function renderHome() {
  if ($('#home').hidden) return;
  renderSetupCard();
  const nav = ui.nav;
  const projName = s => { const p = projectByKey(s.machine + ':' + s.project); return p ? p.name : s.project; };
  const order = { waiting: 0, failed: 1, finished: 2, working: 3, starting: 4, idle: 5, shell: 6, exited: 7, stopped: 8, elsewhere: 9, offline: 10 };
  const all = snap.sessions.map(s => ({ s, st: stateOf(s), proj: projName(s) })).sort((a, b) => ((order[a.st] || 0) - (order[b.st] || 0)) || (a.s.order - b.s.order));
  const groups = nav === 'attention'
    ? [['Needs you', x => ATTN(x.s)]]
    : [['Needs you', x => ATTN(x.s)], ['Finished', x => x.st === 'finished'], ['Working', x => x.st === 'working'], ['Everything else', x => !ATTN(x.s) && x.st !== 'finished' && x.st !== 'working']];
  const items = [];
  for (const [title, f] of groups) {
    const rows = all.filter(f);
    if (!rows.length && nav !== 'attention') continue;
    items.push({ k: 'h:' + title, t: 'h', title });
    if (!rows.length) items.push({ k: 'none', t: 'none', text: 'Nothing needs you.' });
    for (const x of rows) items.push({ k: 'r:' + x.s.id, t: 'r', ...x, acc: x.s.account, colour: STATE_COLOUR[x.st] || 'idle' });
  }
  const hr = new Date().getHours();
  Dom.text($('#home-h1'), nav === 'attention' ? 'Needs you' : hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening');
  const nproj = new Set(snap.sessions.map(s => s.machine + ':' + s.project)).size;
  const live = snap.sessions.filter(s => s.status === 'live').length;
  Dom.text($('#home-sub'), snap.sessions.length ? `${live} live of ${snap.sessions.length} session${snap.sessions.length === 1 ? '' : 's'} across ${nproj} project${nproj === 1 ? '' : 's'}. Pick a project on the left, or a session below.` : 'No sessions yet. Pick a project on the left, then press the session button or Ctrl+Shift+N.');
  const sigOf = it => JSON.stringify([it.st, it.s && [it.s.name, it.s.label, it.s.status, it.s.glyph, it.s.account], it.proj]);
  const sig = JSON.stringify(items.map(it => [it.k, sigOf(it)]));
  if (sig === lastHomeSig) return;
  lastHomeSig = sig;
  Dom.keyed($('#home-list'), items, it => it.k, it => {
    if (it.t === 'h') return Dom.h('h2', null, it.title);
    if (it.t === 'none') return Dom.h('div', 'none', it.text);
    const r = Dom.h('div', 'row'); r.tabIndex = 0; r.setAttribute('role', 'button');
    r.appendChild(Dom.h('span', 'acc'));
    r.appendChild(Dom.h('span', 'sname'));
    r.appendChild(Dom.h('span', 'proj'));
    r.appendChild(Dom.h('span', 'label'));
    const st = Dom.h('span', 'state'); st.appendChild(Sidebar.glyphEl()); st.appendChild(Dom.h('span', 'word')); r.appendChild(st);
    r.appendChild(Dom.h('span', 'age'));
    return r;
  }, (r, it) => {
    if (it.t !== 'r') return;
    const [acc, name, proj, label, st, age] = r.children;
    r.style.cssText = `--acc: var(--acc-${it.acc}); --acc-strong: var(--acc-${it.acc}-strong); --st: var(--st-${it.colour})`;
    Dom.text(acc, String(it.acc));
    Dom.text(name, it.s.name);
    Dom.text(proj, it.proj + (it.s.machine === 'laptop' ? ' (laptop)' : ''));
    Dom.text(label, it.s.label || '');
    Sidebar.setGlyph(st.firstChild, Sidebar.glyphOf(it.s));
    Dom.text(st.lastChild, STATE_WORD[it.st] || it.st);
    Dom.attr(r, 'aria-label', `${it.s.name}, ${STATE_WORD[it.st] || it.st}, ${it.proj}${it.s.label ? ', ' + it.s.label : ''}`);
    if (it.s.stateSince) { r.dataset.since = String(it.s.stateSince); Dom.text(age, fmtAge(Date.now() - it.s.stateSince)); } else { delete r.dataset.since; Dom.text(age, ''); }
  }, { sig: sigOf });
}
$('#home-list').addEventListener('click', e => {
  const r = e.target.closest('.row');
  if (!r || Dom.isLeaving(r)) return;
  const s = sessionById(r.dataset.key.slice(2));
  if (s) H.onSession(s);
});
$('#home-list').addEventListener('keydown', e => {
  const r = e.target.closest('.row'); if (!r) return;
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); r.click(); return; }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const rows = [...$$('#home-list .row')];
    const n = rows[rows.indexOf(r) + (e.key === 'ArrowDown' ? 1 : -1)];
    if (n) n.focus();
  }
});

function setNav(nav) {
  if (!NAVS.includes(nav)) return;
  if (nav === ui.nav && (nav === 'projects' || nav === 'settings')) { toggleSidebar(); return; }
  ui.nav = nav;
  if (ui.sidebar.collapsed && (nav === 'projects' || nav === 'settings')) ui.sidebar.collapsed = false;
  ui.sidebar.hidden = false;
  saveUi();
  renderAll();
}
function toggleSidebar() {
  if (ui.sidebar.hidden) { ui.sidebar.hidden = false; ui.sidebar.collapsed = false; }
  else ui.sidebar.collapsed = !ui.sidebar.collapsed;
  saveUi();
  renderShell();
}
// the whole left side, icons and sidebar, for the most terminal room; the status bar button brings it back
function togglePanel() {
  ui.sidebar.hidden = !ui.sidebar.hidden;
  saveUi();
  renderShell();
}
$('#panel-btn').addEventListener('click', togglePanel);
$('#activity').addEventListener('click', e => { const b = e.target.closest('.act'); if (b) setNav(b.dataset.nav); });

// sidebar width: drag the sash, double click resets; saved once on release
(() => {
  const sash = $('#sash'), app = $('#app');
  const MIN = 220, MAX = 480, DEF = 300;
  let x0 = 0, w0 = 0;
  sash.addEventListener('pointerdown', e => { if (e.button !== 0) return; sash.setPointerCapture(e.pointerId); x0 = e.clientX; w0 = ui.sidebar.w; app.classList.add('resizing'); });
  sash.addEventListener('pointermove', e => {
    if (!app.classList.contains('resizing')) return;
    ui.sidebar.w = Math.min(MAX, Math.max(MIN, Math.round(w0 + (e.clientX - x0) / rz('side'))));
    app.style.setProperty('--sidebar-w', ui.sidebar.w + 'px');
  });
  const end = () => { if (!app.classList.contains('resizing')) return; app.classList.remove('resizing'); saveUi(); };
  sash.addEventListener('pointerup', end);
  sash.addEventListener('pointercancel', end);
  sash.addEventListener('dblclick', () => { ui.sidebar.w = DEF; saveUi(); renderShell(); });
  sash.addEventListener('keydown', e => {
    const step = e.key === 'ArrowLeft' ? -16 : e.key === 'ArrowRight' ? 16 : 0;
    if (step) ui.sidebar.w = Math.min(MAX, Math.max(MIN, ui.sidebar.w + step));
    else if (e.key === 'Home') ui.sidebar.w = MIN;
    else if (e.key === 'End') ui.sidebar.w = MAX;
    else if (e.key === 'Enter') ui.sidebar.w = DEF;
    else return;
    e.preventDefault(); saveUi(); renderShell();
  });
  $('#sb-reset').onclick = () => { ui.sidebar.w = DEF; saveUi(); renderShell(); };
})();

// ---------- attention: desktop notifications (renderer Notification API, opt-in) ----------
const notifyAllowed = () => typeof Notification !== 'undefined' && Notification.permission === 'granted';
function renderAttentionSettings() {
  $('#flash-toggle').checked = ui.flash !== false;
  $('#notify-toggle').checked = !!ui.notify;
  Dom.text($('#notify-note'), !ui.notify ? 'Off. The badge, the window title and the taskbar flash still work.'
    : notifyAllowed() ? 'Sent only while Desk is in the background. Clicking one opens Needs you.'
    : 'Windows has not allowed notifications for Desk, so none will be sent.');
}
$('#flash-toggle').onchange = e => { ui.flash = e.target.checked; saveUi(); };
$('#notify-toggle').onchange = async e => {
  ui.notify = e.target.checked;
  if (ui.notify && !notifyAllowed() && typeof Notification !== 'undefined') await Notification.requestPermission();
  saveUi(); renderAttentionSettings();
};
$('#notify-test').onclick = () => {
  if (!notifyAllowed()) { toast('Windows has not allowed notifications for Desk', 'error'); return; }
  new Notification((snap.setup && snap.setup.appName) || 'Claude Desk', { body: 'This is what a session needing you looks like.' });
};
let attnWas = null;
function notifyTransitions() {
  const now = new Map(snap.sessions.map(s => [s.id, ATTN(s)]));
  const was = attnWas; attnWas = now;
  if (!was || !ui.notify || document.hasFocus() || !notifyAllowed()) return;
  for (const s of snap.sessions) {
    if (!now.get(s.id) || was.get(s.id) !== false) continue;
    const p = projectByKey(s.machine + ':' + s.project);
    const n = new Notification(`${s.name} ${s.glyph === 'failed' ? 'failed' : 'needs you'}`, { body: `${p ? p.name : s.project}${s.label ? ': ' + s.label : ''}`, tag: 'desk-' + s.id });
    n.onclick = () => { setNav('attention'); window.focus(); };
  }
}

// theme: data-theme on <html> drives the tokens; xterm gets the --term-* values once per change, never animated
let termTheme = null;
function applyTheme() {
  const t = ui.theme === 'light' || ui.theme === 'dark' ? ui.theme : null;
  if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
  if (typeof applyAccent === 'function') applyAccent();
  const cs = getComputedStyle(document.documentElement);
  const v = n => cs.getPropertyValue(n).trim();
  termTheme = { background: v('--term-bg'), foreground: v('--term-fg'), cursor: v('--term-cursor'), cursorAccent: v('--term-bg'), selectionBackground: v('--term-selection') };
  for (const c of ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white']) {
    termTheme[c] = v('--ansi-' + c);
    termTheme['bright' + c[0].toUpperCase() + c.slice(1)] = v('--ansi-bright-' + c);
  }
  if (snap) for (const s of snap.sessions) { const r = Terminals.get(s.id); if (r && r.term) r.term.options.theme = termTheme; }
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (!ui.theme) applyTheme(); });
// a terminal is created inside Terminals.place before its first await, so the theme lands before any bytes do
(() => {
  const place = Terminals.place;
  Terminals.place = (id, slotEl) => { const p = place(id, slotEl); const r = Terminals.get(id); if (r && r.term && termTheme) r.term.options.theme = termTheme; return p; };
})();

// ---------- account picker: a chip button on the tab bar, a popover with colour, role and the limits from the status files ----------
function accountsFor(p) { return !p ? [] : p.machine === 'pc' ? (snap.accountList || []).map(a => a.id) : (snap.laptop.accounts || [1]); }
function accInfo(n) { return (snap && snap.accountList || []).find(a => a.id === n) || null; }
function accName(n) { const a = accInfo(n); return a ? a.name : `claude-${n}`; }
// each account's colour from the store, as --acc-N and its darker edge, so any number of accounts gets a chip
let accColourSig = '';
function applyAccountColours() {
  const list = (snap && snap.accountList) || [];
  const sig = JSON.stringify(list.map(a => [a.id, a.colour]));
  if (sig === accColourSig) return;
  accColourSig = sig;
  const st = document.documentElement.style;
  for (const a of list) {
    st.setProperty(`--acc-${a.id}`, a.colour);
    st.setProperty(`--acc-${a.id}-strong`, `color-mix(in oklab, ${a.colour} var(--acc-mix), var(--ink))`);
  }
}
function currentAccount() {
  const p = currentProject(), list = accountsFor(p);
  const last = p && ui.lastAccount[p.machine];
  return list.includes(last) ? last : (list[0] || 1);
}
function setAccChip(chip, n) {
  Dom.text(chip, String(n));
  const v = `var(--acc-${n})`;
  if (chip.style.getPropertyValue('--acc') !== v) { chip.style.setProperty('--acc', v); chip.style.setProperty('--acc-strong', `var(--acc-${n}-strong)`); }
}
const pct = v => v == null ? null : Math.max(0, Math.min(100, Math.round(v)));
function fmtReset(t) {
  if (!t) return '';
  const ms = t * 1000 - Date.now();
  if (ms <= 0) return 'reset due';
  const h = Math.floor(ms / 3600000), m = Math.round((ms % 3600000) / 60000);
  return h >= 24 ? `resets in ${Math.round(h / 24)} d` : h ? `resets in ${h} h ${m} m` : `resets in ${m} m`;
}
const monthName = m => new Date(Number(m.slice(0, 4)), Number(m.slice(5)) - 1, 1).toLocaleString('en-GB', { month: 'short' });
const usd = v => '$' + (Math.abs(v) >= 100 ? Math.round(v) : v.toFixed(2));
function limitText(a) {
  if (a && a.cost) return `${a.cost.open ? `${usd(a.cost.live)} open now, ` : ''}${usd(a.cost.total)} in ${monthName(a.cost.month)}`;
  if (!a || a.updated == null) return 'no limit data';
  const stale = Date.now() / 1000 - a.updated > 3600;
  const five = pct(a.five_hour), seven = pct(a.seven_day);
  const parts = [];
  if (five != null) parts.push(`5 h ${five}%`);
  if (seven != null) parts.push(`7 d ${seven}%`);
  return (parts.join(', ') || 'no limit data') + (stale ? ' (stale)' : '');
}
let lastAccSig = '';
function renderAccount() {
  const p = currentProject();
  const list = accountsFor(p), cur = currentAccount();
  const btn = $('#accbtn');
  btn.disabled = !p;
  $('#say-btn').disabled = !claudeProjects().length;
  setAccChip(btn.firstElementChild, p ? cur : 0);
  const info = accInfo(cur);
  Dom.text(btn.children[1], p ? ((p.machine === 'pc' && info && (info.role || info.name)) || snap.roles[cur] || accName(cur)) : '');
  Dom.attr(btn, 'title', p ? `New sessions start as ${accName(cur)}. Click to change` : 'Pick a project first');
  for (const box of [$('#newpop .rows'), $('#panemenu .rows')]) if (box && !box.parentElement.hidden) fillAccRows(box, list, cur);
  const pop = $('#accpop');
  if (pop.hidden) return;
  const sig = JSON.stringify([list, cur, list.map(n => (snap.accounts || {})[n]), list.map(accInfo)]);
  if (sig === lastAccSig) return;
  lastAccSig = sig;
  fillAccRows(pop, list, cur);
}
// one row per account with its role and limits (or, for an API credit account, what it has cost); the account chip, + session and the pane menu share it
function fillAccRows(pop, list, cur) {
  const acc = snap.accounts || {};
  const pc = (currentProject() || {}).machine !== 'laptop';
  Dom.keyed(pop, list.map(n => ({ n, a: acc[n], i: pc ? accInfo(n) : null })), it => String(it.n), () => {
    const r = Dom.h('div', 'row'); r.setAttribute('role', 'menuitemradio'); r.tabIndex = 0;
    r.appendChild(Dom.h('span', 'acc'));
    const t = Dom.h('span', 'txt'); t.appendChild(Dom.h('span', 'nm')); t.appendChild(Dom.h('span', 'role')); r.appendChild(t);
    const lim = Dom.h('span', 'lim'); lim.appendChild(Dom.h('span', 'bars')); lim.appendChild(Dom.h('span', 'lt')); r.appendChild(lim);
    const bars = lim.firstChild; for (let i = 0; i < 2; i++) { const b = Dom.h('span', 'bar'); b.appendChild(Dom.h('i')); bars.appendChild(b); }
    return r;
  }, (r, it) => {
    r.classList.toggle('on', it.n === cur);
    r.setAttribute('aria-checked', it.n === cur ? 'true' : 'false');
    r.dataset.n = it.n;
    setAccChip(r.firstChild, it.n);
    Dom.text(r.children[1].firstChild, it.i ? it.i.name : `claude-${it.n}`);
    Dom.text(r.children[1].lastChild, it.i ? (it.i.signedIn ? (it.i.role || it.i.email || 'general') : 'not signed in yet') : (snap.roles[it.n] || 'general'));
    const lim = r.lastChild, bars = lim.firstChild;
    const five = it.a ? pct(it.a.five_hour) : null, seven = it.a ? pct(it.a.seven_day) : null;
    bars.hidden = five == null && seven == null;
    bars.children[0].hidden = five == null; bars.children[0].firstChild.style.width = (five || 0) + '%';
    bars.children[1].hidden = seven == null; bars.children[1].firstChild.style.width = (seven || 0) + '%';
    bars.children[0].classList.toggle('hot', five != null && five >= 80);
    bars.children[1].classList.toggle('hot', seven != null && seven >= 80);
    Dom.text(lim.lastChild, limitText(it.a));
    const c = it.a && it.a.cost;
    if (c) Dom.attr(r, 'title', `API credit account, billed per token. ${c.sessions} session${c.sessions === 1 ? '' : 's'} in ${monthName(c.month)}, ${c.open} open now. From the status line, so the last 30 s of a session can be missing`);
    else Dom.attr(r, 'title', it.a && it.a.five_hour_reset ? `${fmtReset(it.a.five_hour_reset)} (5 h)${it.a.seven_day_reset ? `, ${fmtReset(it.a.seven_day_reset)} (7 d)` : ''}` : null);
  }, { sig: it => JSON.stringify([it.n === cur, it.a, it.i]) });
}
let accPop = null;
function openAccountPop(open) { accPop.open(open); }
$('#accpop').addEventListener('click', e => {
  const r = e.target.closest('.row'); if (!r) return;
  const p = currentProject(); if (!p) return;
  ui.lastAccount[p.machine] = Number(r.dataset.n); saveUi();
  openAccountPop(false); renderAccount();
});

let lastTabSig = '';
function renderTabs() {
  const tabs = $('#tabs');
  const p = currentProject();
  $('#panes-btn').disabled = !p;
  if (!p) { Dom.keyed(tabs, [], () => '', () => null, () => {}); lastTabSig = ''; return; }
  const v = view(ui.current);
  const sessions = snap.sessions.filter(s => s.machine === p.machine && s.project === p.dir).sort((a, b) => a.order - b.order);
  const sig = JSON.stringify([sessions.map(s => [s.id, s.name, s.glyph, s.status, s.state, s.account]), v.slots, v.focus, v.n]);
  for (const b of $$('#panespop .split')) { b.classList.toggle('on', Number(b.dataset.n) === v.n); b.setAttribute('aria-checked', Number(b.dataset.n) === v.n ? 'true' : 'false'); }
  Dom.text($('#panes-n'), `${v.n} pane${v.n === 1 ? '' : 's'}`);
  if (sig === lastTabSig) return;
  lastTabSig = sig;
  const items = sessions.map(s => {
    const idx = v.slots.indexOf(s.id);
    const placed = idx >= 0 && idx < v.n;
    return { s, placed, focused: placed && idx === v.focus, slotno: placed && v.n > 1 ? String(idx + 1) : '', colour: (accInfo(s.account) || {}).colour || snap.colours[s.account] || snap.colours[0] };
  });
  Dom.keyed(tabs, items, it => it.s.id, () => {
    const t = document.createElement('div');
    t.className = 'tab';
    t.draggable = true;
    t.setAttribute('role', 'tab'); t.tabIndex = -1;
    t.appendChild(Dom.h('span', 'dot'));
    t.appendChild(Sidebar.glyphEl());
    t.appendChild(Dom.h('span', 'tname'));
    t.appendChild(Dom.h('span', 'slotno'));
    return t;
  }, (t, it) => {
    const [dot, glyph, name, slotno] = t.children;
    t.classList.toggle('placed', it.placed);
    t.classList.toggle('focused', it.focused);
    if (dot.style.background !== it.colour) dot.style.background = it.colour;
    Sidebar.setGlyph(glyph, Sidebar.glyphOf(it.s));
    Dom.text(name, it.s.name);
    slotno.hidden = !it.slotno; Dom.text(slotno, it.slotno);
    Dom.attr(t, 'aria-selected', it.focused ? 'true' : 'false'); t.tabIndex = it.focused ? 0 : -1;
    Dom.attr(t, 'aria-label', `${it.s.name}, ${STATE_WORD[stateOf(it.s)] || stateOf(it.s)}${it.placed ? (it.slotno ? `, pane ${it.slotno}` : ', shown') : ''}`);
  }, { sig: it => JSON.stringify([it.s.name, it.s.glyph, it.s.status, it.s.state, it.placed, it.focused, it.slotno, it.colour]) });
  if (!items.some(it => it.focused)) { const first = tabs.querySelector('.tab'); if (first) first.tabIndex = 0; }
  const f = items.find(it => it.focused);
  if (f) revealTab(f.s.id);
  updateTabOverflow();
  renderTabPop(items);
}
// the strip hides its scrollbar; a fade at either edge says there is more, the chevron lists everything
function updateTabOverflow() {
  const tabs = $('#tabs'), strip = $('#tabstrip');
  const over = tabs.scrollWidth > tabs.clientWidth + 1;
  strip.classList.toggle('fade-l', over && tabs.scrollLeft > 1);
  strip.classList.toggle('fade-r', over && tabs.scrollLeft + tabs.clientWidth < tabs.scrollWidth - 1);
  $('#tabmenu-btn').hidden = !over;
  if (!over) tabPop.open(false);
}
function revealTab(id) {
  const tabs = $('#tabs'), t = tabs.querySelector(`.tab[data-key="${id}"]`);
  if (!t) return;
  const l = t.offsetLeft, r = l + t.offsetWidth;
  if (l < tabs.scrollLeft) tabs.scrollLeft = l;
  else if (r > tabs.scrollLeft + tabs.clientWidth) tabs.scrollLeft = r - tabs.clientWidth;
}
$('#tabs').addEventListener('scroll', updateTabOverflow, { passive: true });
$('#tabs').addEventListener('wheel', e => { if (!e.deltaY || e.deltaX) return; e.preventDefault(); $('#tabs').scrollLeft += e.deltaY; }, { passive: false });
new ResizeObserver(updateTabOverflow).observe($('#tabs'));
let lastTabPopSig = '';
function renderTabPop(items) {
  const pop = $('#tabpop');
  if (pop.hidden) { lastTabPopSig = ''; return; }
  const sig = JSON.stringify(items.map(it => [it.s.id, it.s.name, it.s.account, it.placed, it.slotno, stateOf(it.s)]));
  if (sig === lastTabPopSig) return;
  lastTabPopSig = sig;
  Dom.keyed(pop, items, it => it.s.id, () => {
    const r = Dom.h('div', 'row'); r.setAttribute('role', 'menuitem'); r.tabIndex = 0;
    r.appendChild(Dom.h('span', 'acc'));
    const t = Dom.h('span', 'txt'); t.appendChild(Dom.h('span', 'nm')); t.appendChild(Dom.h('span', 'role')); r.appendChild(t);
    r.appendChild(Dom.h('span', 'lt'));
    return r;
  }, (r, it) => {
    r.classList.toggle('on', it.placed);
    setAccChip(r.firstChild, it.s.account);
    Dom.text(r.children[1].firstChild, it.s.name);
    Dom.text(r.children[1].lastChild, STATE_WORD[stateOf(it.s)] || stateOf(it.s));
    Dom.text(r.lastChild, it.placed ? (it.slotno ? `pane ${it.slotno}` : 'shown') : '');
  }, { sig: it => JSON.stringify([it.s.name, it.s.account, it.placed, it.slotno, stateOf(it.s)]) });
}
// a popover under a tab bar button: Esc, a click outside and a pick close it; focus lands on the first marked row
function popover(popSel, btnSel, onOpen) {
  const api = {
    isOpen: () => !$(popSel).hidden,
    open(open) {
      const pop = $(popSel), btn = $(btnSel);
      if (open === !pop.hidden) return;
      pop.hidden = !open;
      btn.classList.toggle('on', open);
      if (open) { onOpen(); const r = pop.querySelector('.row.on') || pop.querySelector('.row'); if (r) r.focus(); }
      else if (document.activeElement && pop.contains(document.activeElement)) btn.focus();
    },
  };
  $(btnSel).onclick = e => { e.stopPropagation(); api.open(!api.isOpen()); };
  $(popSel).addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.target.closest('.row')?.click(); } });
  document.addEventListener('mousedown', e => { if (api.isOpen() && !e.target.closest(popSel + ', ' + btnSel)) api.open(false); });
  POPS.push(api);
  return api;
}
const POPS = [];
accPop = popover('#accpop', '#accbtn', () => { lastAccSig = ''; renderAccount(); });
const tabPop = popover('#tabpop', '#tabmenu-btn', () => { lastTabPopSig = ''; lastTabSig = ''; renderTabs(); });
// the panes menu hangs under its button; the bar it sits in may be zoomed, so the offset is in the bar's own pixels
const panesPop = popover('#panespop', '#panes-btn', () => {
  const bar = $('#tabbar').getBoundingClientRect(), b = $('#panes-btn').getBoundingClientRect();
  $('#panespop').style.right = Math.max(4, (bar.right - b.right) / rz('top')) + 'px';
  lastTabSig = ''; renderTabs();
});
$('#panespop').addEventListener('click', e => { const r = e.target.closest('.split'); if (!r) return; panesPop.open(false); setSplit(Number(r.dataset.n)); });
// + session asks which account; the one the chip shows is marked, so Enter keeps it
const newPop = popover('#newpop', '#new-session', () => {
  const bar = $('#tabbar').getBoundingClientRect(), b = $('#new-session').getBoundingClientRect();
  $('#newpop').style.right = Math.max(4, (bar.right - b.right) / rz('top')) + 'px';
  fillAccRows($('#newpop .rows'), accountsFor(currentProject()), currentAccount());
});
$('#newpop').addEventListener('click', e => { const r = e.target.closest('.row'); if (!r || !r.dataset.n) return; newPop.open(false); newSession('claude', Number(r.dataset.n)); });

// right click on a pane's header or an empty pane (Shift+right click over a terminal) opens this at the pointer
const paneMenu = (() => {
  const el = $('#panemenu');
  let at = -1;
  const act = (a, icon, text, note) => {
    const r = Dom.h('div', 'row act'); r.setAttribute('role', 'menuitem'); r.tabIndex = 0; r.dataset.act = a;
    r.append(svgUse(icon), Dom.h('span', 'nm', text), Dom.h('span', 'lt', note || ''));
    return r;
  };
  function build(i) {
    const v = view(ui.current), s = sessionById(v.slots[i]);
    const rows = Dom.h('div', 'rows');
    el.replaceChildren(Dom.h('div', 'caps', `New Claude session in pane ${i + 1}`), rows, Dom.h('div', 'line'), act('shell', 'i-terminal', 'New shell in this pane'));
    if (s) el.appendChild(act('empty', 'i-minus', 'Take the session out', 'it keeps running as a tab'));
    if (v.n > 1) el.appendChild(act('close', 'i-x', 'Close pane', `${v.n} panes to ${v.n - 1}`));
    fillAccRows(rows, accountsFor(currentProject()), currentAccount());
  }
  const api = {
    isOpen: () => !el.hidden,
    open(open, x, y, i) {
      if (!open) { el.hidden = true; at = -1; return; }
      at = i; build(i); el.hidden = false;
      const r = el.getBoundingClientRect();
      el.style.left = Math.max(4, Math.min(x, innerWidth - r.width - 4)) + 'px';
      el.style.top = Math.max(4, Math.min(y, innerHeight - r.height - 4)) + 'px';
      (el.querySelector('.row.on') || el.querySelector('.row')).focus();
    },
  };
  el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.target.closest('.row')?.click(); } });
  el.addEventListener('click', e => {
    const r = e.target.closest('.row'); if (!r || at < 0) return;
    const i = at; api.open(false);
    if (r.dataset.n) newSession('claude', Number(r.dataset.n), i);
    else if (r.dataset.act === 'shell') newSession('shell', 0, i);
    else if (r.dataset.act === 'empty') emptyPane(i);
    else if (r.dataset.act === 'close') closePane(i);
  });
  document.addEventListener('mousedown', e => { if (api.isOpen() && !el.contains(e.target)) api.open(false); });
  window.addEventListener('blur', () => api.open(false));
  POPS.push(api);
  return api;
})();
$('#slots').addEventListener('contextmenu', e => {
  const slot = e.target.closest('.slot');
  if (!slot || !ui.current || (e.target.closest('.termwrap') && !e.shiftKey)) return;
  e.preventDefault();
  const i = Number(slot.dataset.i);
  focusSlot(i);
  paneMenu.open(true, e.clientX, e.clientY, i);
});
$('#tabpop').addEventListener('click', e => {
  const r = e.target.closest('.row'); if (!r || Dom.isLeaving(r)) return;
  tabPop.open(false); placeInFocused(r.dataset.key);
});
const tabOf = e => { const t = e.target.closest('.tab'); return t && !Dom.isLeaving(t) ? t.dataset.key : null; };
$('#tabs').addEventListener('click', e => { const id = tabOf(e); if (id) placeInFocused(id); });
$('#tabs').addEventListener('keydown', e => {
  const t = e.target.closest('.tab'); if (!t) return;
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); t.click(); return; }
  const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
  const all = [...$('#tabs').querySelectorAll('.tab')].filter(x => !Dom.isLeaving(x));
  const n = d ? all[all.indexOf(t) + d] : e.key === 'Home' ? all[0] : e.key === 'End' ? all[all.length - 1] : null;
  if (n) { e.preventDefault(); for (const x of all) x.tabIndex = x === n ? 0 : -1; n.focus(); revealTab(n.dataset.key); }
});
$('#tabs').addEventListener('dragstart', e => { const id = tabOf(e); if (!id) return; dragId = id; e.target.closest('.tab').classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; });
$('#tabs').addEventListener('dragend', e => { dragId = null; const t = e.target.closest('.tab'); if (t) t.classList.remove('dragging'); });

function renderSlots() {
  const slotsEl = $('#slots');
  const v = view(ui.current);
  slotsEl.className = 'lay n' + v.n;
  const want = new Set();
  for (let i = 0; i < v.n; i++) if (v.slots[i] && sessionById(v.slots[i])) want.add(v.slots[i]);
  // anything not shown in this view goes back to the pool; it keeps running
  for (const w of document.querySelectorAll('#slots .termwrap')) if (!want.has(w.dataset.id)) Terminals.unplace(w.dataset.id);
  // a session still wanted in a lower pane must not leave with the pane that is removed
  for (let el = paneEls(); el.length > v.n; el = paneEls()) { const last = el[el.length - 1]; for (const w of last.querySelectorAll(':scope > .termwrap')) Terminals.unplace(w.dataset.id); last.remove(); }
  while (paneEls().length < v.n) {
    const d = document.createElement('div');
    d.className = 'slot';
    const i = paneEls().length;
    d.dataset.i = i;
    d.addEventListener('mousedown', () => focusSlot(i));
    d.addEventListener('dragover', e => { if (dragId) { e.preventDefault(); d.classList.add('dragover'); } });
    d.addEventListener('dragleave', () => d.classList.remove('dragover'));
    d.addEventListener('drop', e => { e.preventDefault(); d.classList.remove('dragover'); if (dragId) placeInSlot(dragId, i); });
    d.appendChild(slotHead());
    slotsEl.appendChild(d);
  }
  const panes = paneEls();
  for (let i = 0; i < v.n; i++) {
    const slot = panes[i];
    slot.classList.toggle('focused', i === v.focus);
    const id = v.slots[i];
    slot.dataset.sid = id && sessionById(id) ? id : '';
    if (id && sessionById(id)) {
      if (!slot.querySelector(`.termwrap[data-id="${id}"]`)) Terminals.place(id, slot);
      else { const e = slot.querySelector('.slot-empty'); if (e) e.remove(); }
      const s = sessionById(id);
      if ((s.status === 'stopped' || s.status === 'exited') && !Terminals.hasOverlay(id)) Terminals.overlay(id, notStartedCopy(s), true);
    } else {
      for (const w of slot.querySelectorAll(':scope > .termwrap')) Terminals.unplace(w.dataset.id);
      if (!slot.querySelector('.slot-empty')) { const e = document.createElement('div'); e.className = 'slot-empty'; e.textContent = 'click a tab, or drag one here'; slot.appendChild(e); }
    }
  }
  layoutSlots();
  renderPaneHeads();
  renderProjbar();
  Terminals.fitAll();
}
const paneEls = () => [...$('#slots').querySelectorAll(':scope > .slot')];

// panes per row, top row first; 3, 5 and 7 put the odd one out on the bottom row
const ROWS = { 1: [1], 2: [2], 3: [2, 1], 4: [2, 2], 5: [3, 2], 6: [3, 3], 7: [4, 3], 8: [4, 4] };
const GAP = 3, MIN_W = 160, MIN_H = 90;
// row heights and each row's column widths as fractions, kept per pane count so going 4 to 2 and back keeps the 4
function splits(v) {
  const rows = ROWS[v.n];
  if (!v.sizes || typeof v.sizes !== 'object') v.sizes = {};
  const s = v.sizes[v.n];
  const ok = s && Array.isArray(s.r) && s.r.length === rows.length && Array.isArray(s.c) && s.c.length === rows.length && s.c.every((c, j) => Array.isArray(c) && c.length === rows[j]);
  return ok ? s : (v.sizes[v.n] = evenSplit(v.n));
}
const evenSplit = n => ({ r: ROWS[n].map(() => 1 / ROWS[n].length), c: ROWS[n].map(k => Array(k).fill(1 / k)) });
const edges = fr => { const e = [0]; for (const f of fr) e.push(e[e.length - 1] + f); e[e.length - 1] = 1; return e; };
// a pane edge inside the area gives half the gap to its neighbour
const span = (a, b) => [`calc(${GAP}px + (100% - ${2 * GAP}px) * ${a} + ${a > 0 ? GAP / 2 : 0}px)`, `calc((100% - ${2 * GAP}px) * ${b - a} - ${(a > 0 ? GAP / 2 : 0) + (b < 1 ? GAP / 2 : 0)}px)`];
const sashAt = a => `calc(${GAP}px + (100% - ${2 * GAP}px) * ${a})`;
function layoutSlots() {
  const el = $('#slots'), v = view(ui.current), s = splits(v), panes = paneEls(), ye = edges(s.r), keep = new Set();
  const sash = (key, dir, title) => {
    keep.add(key);
    let d = el.querySelector(`:scope > .psash[data-k="${key}"]`);
    if (!d) {
      d = Dom.h('div', 'psash ' + dir); d.dataset.k = key; d.tabIndex = 0; d.title = title;
      d.setAttribute('role', 'separator'); d.setAttribute('aria-orientation', dir === 'v' ? 'vertical' : 'horizontal'); d.setAttribute('aria-label', title);
      el.appendChild(d);
    }
    return d.style;
  };
  let i = 0;
  ye.slice(0, -1).forEach((y0, j) => {
    const [top, h] = span(y0, ye[j + 1]), xe = edges(s.c[j]);
    xe.slice(0, -1).forEach((x0, k) => {
      const [left, w] = span(x0, xe[k + 1]), p = panes[i++];
      if (p) Object.assign(p.style, { left, top, width: w, height: h });
      if (k > 0) Object.assign(sash(`c${j}.${k}`, 'v', 'Drag to resize these panes. Double click to even them out.'), { left: sashAt(x0), top, height: h });
    });
    if (j > 0) Object.assign(sash(`r${j}`, 'h', 'Drag to resize the rows. Double click to even them out.'), { top: sashAt(y0), left: GAP + 'px', width: `calc(100% - ${2 * GAP}px)` });
  });
  for (const d of el.querySelectorAll(':scope > .psash')) if (!keep.has(d.dataset.k)) d.remove();
}
// moves the edge between fr[k-1] and fr[k] by d, neither side below min
function nudge(fr, k, d, min) {
  const a = fr[k - 1], b = fr[k], m = Math.min(min, (a + b) / 2);
  const na = Math.min(a + b - m, Math.max(m, a + d));
  fr[k - 1] = na; fr[k] = a + b - na;
}
let refitAt = 0;
function refitSoon() {
  if (refitAt) return;
  refitAt = setTimeout(() => { refitAt = 0; Terminals.fitAll(); }, 100);
}
// a column edge that lines up with one in the other row moves with it, so a 2x2 drags as one cross
function sashTargets(s, key) {
  if (key[0] === 'r') return { rows: true, k: Number(key.slice(1)) };
  const [j, k] = key.slice(1).split('.').map(Number), x = edges(s.c[j])[k], cols = [];
  s.c.forEach((c, jj) => { if (c.length === s.c[j].length && Math.abs(edges(c)[k] - x) < 0.005) cols.push(jj); });
  return { rows: false, k, cols };
}
function moveSash(key, px, base) {
  const s = splits(view(ui.current)), t = sashTargets(base, key), box = $('#slots').getBoundingClientRect();
  if (t.rows) { s.r = base.r.slice(); nudge(s.r, t.k, px / Math.max(1, box.height - 2 * GAP), MIN_H / Math.max(1, box.height)); }
  else for (const j of t.cols) { s.c[j] = base.c[j].slice(); nudge(s.c[j], t.k, px / Math.max(1, box.width - 2 * GAP), MIN_W / Math.max(1, box.width)); }
  layoutSlots(); refitSoon();
}
{
  const el = $('#slots');
  let drag = null;
  const copy = s => ({ r: s.r.slice(), c: s.c.map(c => c.slice()) });
  el.addEventListener('pointerdown', e => {
    const d = e.target.closest('.psash'); if (!d || e.button !== 0) return;
    e.preventDefault(); d.setPointerCapture(e.pointerId);
    const v = d.classList.contains('v');
    drag = { key: d.dataset.k, v, x: e.clientX, y: e.clientY, base: copy(splits(view(ui.current))) };
    el.classList.add('dragging', v ? 'drag-v' : 'drag-h'); d.classList.add('on');
  });
  el.addEventListener('pointermove', e => { if (drag) moveSash(drag.key, drag.v ? e.clientX - drag.x : e.clientY - drag.y, drag.base); });
  const end = () => {
    if (!drag) return;
    drag = null; el.classList.remove('dragging', 'drag-v', 'drag-h');
    for (const d of el.querySelectorAll(':scope > .psash.on')) d.classList.remove('on');
    saveUi(); Terminals.fitAll();
  };
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end); el.addEventListener('lostpointercapture', end);
  el.addEventListener('dblclick', e => {
    const d = e.target.closest('.psash'); if (!d) return;
    const v = view(ui.current), s = splits(v), even = evenSplit(v.n), t = sashTargets(s, d.dataset.k);
    if (t.rows) s.r = even.r; else for (const j of t.cols) s.c[j] = even.c[j];
    saveUi(); layoutSlots(); Terminals.fitAll();
  });
  // arrows move an edge 16 px, Shift+arrows 80 px
  el.addEventListener('keydown', e => {
    const d = e.target.closest('.psash'); if (!d) return;
    const v = d.classList.contains('v'), fwd = v ? 'ArrowRight' : 'ArrowDown', back = v ? 'ArrowLeft' : 'ArrowUp';
    const dir = e.key === fwd ? 1 : e.key === back ? -1 : 0;
    if (!dir) return;
    e.preventDefault(); moveSash(d.dataset.k, dir * (e.shiftKey ? 80 : 16), copy(splits(view(ui.current)))); saveUi();
  });
}
// what runs in the pane, and that pane's own text size
function slotHead() {
  const h = Dom.h('div', 'slot-head');
  h.append(Dom.h('span', 'dot'), Dom.h('span', 'nm'), Dom.h('span', 'lb'));
  const pz = Dom.h('span', 'pz'); pz.setAttribute('role', 'group'); pz.setAttribute('aria-label', 'Text size in this pane');
  const btn = (z, cls, title, icon) => { const b = Dom.h('button', cls); b.dataset.z = z; b.title = title; if (icon) { b.appendChild(svgUse(icon)); b.setAttribute('aria-label', title); } return b; };
  pz.append(btn('-1', null, 'Smaller text in this pane (Ctrl+- or Ctrl+wheel down over it)', 'i-minus'),
    btn('0', 'zv', 'Text size of this pane. Click to put it back (Ctrl+0)'),
    btn('1', null, 'Bigger text in this pane (Ctrl+= or Ctrl+wheel up over it)', 'i-plus'));
  pz.addEventListener('click', e => {
    const b = e.target.closest('button'), id = h.parentElement && h.parentElement.dataset.sid;
    if (!b || !id) return;
    const z = Number(b.dataset.z);
    if (z) paneStep(id, z); else setPaneSize(id, null);
  });
  h.appendChild(pz);
  return h;
}
function renderPaneHeads() {
  if (!ui.current) return;
  for (const slot of $$('#slots > .slot')) {
    const h = slot.querySelector(':scope > .slot-head'); if (!h) continue;
    const s = sessionById(slot.dataset.sid);
    h.hidden = !s; if (!s) continue;
    const [dot, nm, lb, pz] = h.children, st = stateOf(s), word = STATE_WORD[st] || st;
    const col = `var(--st-${STATE_COLOUR[st] || 'idle'})`;
    if (dot.style.getPropertyValue('--st') !== col) dot.style.setProperty('--st', col);
    Dom.text(nm, s.name);
    Dom.text(lb, s.label ? `${word}, ${s.label}` : word);
    Dom.attr(lb, 'title', s.label || null);
    const pct = panePct(s.id);
    Dom.text(pz.children[1], pct + '%');
    pz.classList.toggle('on', pct !== 100);
  }
}
// which project the panes belong to, above the tabs
function renderProjbar() {
  const p = currentProject(), bar = $('#projbar');
  if (bar.hidden !== !p) bar.hidden = !p;
  if (!p) return;
  Dom.text($('#pb-name'), p.name);
  Dom.text($('#pb-mach'), p.machine === 'laptop' ? 'Laptop' : 'PC');
  Dom.text($('#pb-dir'), p.dir); Dom.attr($('#pb-dir'), 'title', p.dir);
  const ss = snap.sessions.filter(s => s.machine === p.machine && s.project === p.dir);
  const cl = ss.filter(s => s.kind !== 'shell').length, sh = ss.length - cl;
  const wk = ss.filter(s => s.status === 'live' && s.state === 'working').length, at = ss.filter(ATTN).length;
  const parts = [`${cl} Claude session${cl === 1 ? '' : 's'}`, `${sh} shell${sh === 1 ? '' : 's'}`];
  if (wk) parts.push(`${wk} working`);
  if (at) parts.push(`${at} need${at === 1 ? 's' : ''} you`);
  Dom.text($('#pb-count'), parts.join(', '));
  const v = view(ui.current), used = v.slots.slice(0, v.n).filter(id => id && sessionById(id)).length;
  Dom.text($('#pb-panes'), `${used} of ${v.n} pane${v.n === 1 ? '' : 's'} in use`);
}

function showProject(key) {
  ui.current = key;
  if (key) ui.nav = 'projects';
  saveUi();
  renderAll();
  renderSlots();
}

function focusSlot(i) {
  const v = view(ui.current);
  if (v.focus === i) return;
  v.focus = i;
  saveUi();
  for (const [j, s] of paneEls().entries()) s.classList.toggle('focused', j === i);
  renderTabs(); renderSidebar();
  if (v.slots[i]) Terminals.focus(v.slots[i]);
}

function placeInSlot(id, i) {
  const v = view(ui.current);
  const prev = v.slots.indexOf(id);
  if (prev >= 0 && prev !== i) v.slots[prev] = v.slots[i] || null;
  v.slots[i] = id;
  v.focus = i;
  saveUi();
  renderSlots(); renderTabs(); renderSidebar(true);
  flashPlace(id, i);
}
// a 180 ms ring on the pane and a flash on the tab; both are on elements beside the terminal, not around its canvas
function flashPlace(id, i) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  for (const el of [paneEls()[i], $('#tabs').querySelector(`.tab[data-key="${id}"]`)]) {
    if (!el) continue;
    el.classList.remove('placing'); void el.offsetWidth; el.classList.add('placing');
    el.addEventListener('animationend', () => el.classList.remove('placing'), { once: true });
  }
}

function placeInFocused(id) {
  const v = view(ui.current);
  const idx = v.slots.indexOf(id);
  if (idx >= 0 && idx < v.n) { focusSlot(idx); Terminals.focus(id); return; }
  placeInSlot(id, v.focus);
}

// keys the window claims; anything not here reaches the terminal untouched
const KEYMAP = [
  { code: /^Digit[1-8]$/, shift: false, run: e => focusPane(Number(e.code[5]) - 1) },
  { code: /^Digit[1-8]$/, shift: true, run: e => { if (ui.current) setSplit(Number(e.code[5])); } },
  { code: 'Tab', shift: false, run: () => cycleTab(1) },
  { code: 'Tab', shift: true, run: () => cycleTab(-1) },
  { code: 'KeyB', shift: false, run: () => toggleSidebar() },
  { code: 'KeyB', shift: true, run: () => togglePanel() },
  { code: 'KeyK', shift: false, run: () => openPalette('commands') },
  { code: 'KeyP', shift: false, run: () => openPalette('jump') },
  { code: 'KeyN', shift: true, run: () => { if (ui.current) newSession('claude'); } },
  { code: 'KeyT', shift: true, run: () => { if (ui.current) newSession('shell'); } },
  { code: 'Comma', shift: false, run: () => showNav('settings') },
  { code: 'Slash', shift: false, run: () => toggleKeys() },
  { code: /^(Equal|NumpadAdd)$/, shift: false, run: () => zoomKey(1) },
  { code: /^(Minus|NumpadSubtract)$/, shift: false, run: () => zoomKey(-1) },
  { code: /^(Digit0|Numpad0)$/, shift: false, run: () => zoomKey(0) },
  { code: /^(Equal|NumpadAdd)$/, shift: true, run: () => zoomStep(1) },
  { code: /^(Minus|NumpadSubtract)$/, shift: true, run: () => zoomStep(-1) },
  { code: /^(Digit0|Numpad0)$/, shift: true, run: () => setScale(1) },
];
window.addEventListener('keydown', e => {
  if (e.key === 'Escape') { const p = POPS.find(p => p.isOpen()); if (p) { p.open(false); e.preventDefault(); } else clearToasts(); return; }
  if (e.key === 'F1' && !e.ctrlKey && !e.altKey) { e.preventDefault(); toggleKeys(); return; }
  if (!e.ctrlKey || e.altKey || e.metaKey) return;
  const m = KEYMAP.find(k => (k.code instanceof RegExp ? k.code.test(e.code) : k.code === e.code) && k.shift === e.shiftKey);
  if (!m) return;
  e.preventDefault(); e.stopImmediatePropagation();
  m.run(e);
}, true);

// the window zoom is Electron's zoom factor (main clamps it to 0.8-1.6) and scales everything at once.
// On top of it each part has its own: CSS zoom for the sidebar, the bars, the status bar and home, xterm's font size per terminal.
const SCALES = [0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6];
const nearestScale = f => SCALES.reduce((a, b) => Math.abs(b - f) < Math.abs(a - f) ? b : a, 1);
const RZ = [80, 90, 100, 110, 120, 130, 140, 150, 160, 180, 200];
const REGIONS = {
  side: { name: 'Sidebar', els: ['#activity', '#sidebar'] },
  top: { name: 'Top bars', els: ['#projbar', '#tabbar'] },
  status: { name: 'Status bar', els: ['#status'] },
  home: { name: 'Home', els: ['#home'] },
};
const TSIZES = [9, 10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 24, 28];
const rz = r => ((ui.zoom && ui.zoom[r]) || 100) / 100;
function applyZoom() {
  for (const [r, def] of Object.entries(REGIONS)) {
    const v = rz(r) === 1 ? '' : String(rz(r));
    for (const sel of def.els) { const el = $(sel); if (el && el.style.zoom !== v) el.style.zoom = v; }
  }
  const app = $('#app');
  for (const [k, r] of [['--side-z', 'side'], ['--status-z', 'status']]) if (app.style.getPropertyValue(k) !== String(rz(r))) app.style.setProperty(k, String(rz(r)));
}
let zoomHudTimer = 0;
// the readout sits over the part that changed, so it is clear what moved
function hud(text, el) {
  const h = $('#zoom-hud');
  Dom.text(h, text); h.hidden = false;
  if (el && el.offsetWidth) {
    const r = el.getBoundingClientRect();
    h.style.left = Math.min(innerWidth - 120, Math.max(120, r.left + r.width / 2)) + 'px';
    h.style.top = Math.min(innerHeight - 40, Math.max(40, r.top + Math.min(r.height / 2, 140))) + 'px';
  } else { h.style.left = ''; h.style.top = ''; }
  clearTimeout(zoomHudTimer); zoomHudTimer = setTimeout(() => { h.hidden = true; }, 1100);
}
function setScale(f) {
  f = nearestScale(Number(f) || 1);
  if (f !== ui.uiScale) {
    ui.uiScale = f; saveUi();
    desk.zoom(f);
    renderShell();
    setTimeout(Terminals.fitAll, 120);
  }
  hud(`Window ${Math.round(f * 100)}%`);
}
function zoomStep(d) {
  const i = Math.max(0, SCALES.indexOf(ui.uiScale || 1));
  setScale(SCALES[Math.min(SCALES.length - 1, Math.max(0, i + d))]);
}
function setRegionZoom(r, pct) {
  if (!RZ.includes(pct)) pct = 100;
  if (pct === 100) delete ui.zoom[r]; else ui.zoom[r] = pct;
  saveUi(); applyZoom(); renderZoom();
  setTimeout(Terminals.fitAll, 60);
  hud(`${REGIONS[r].name} ${pct}%`, REGIONS[r].els.map(x => $(x)).find(el => el && el.offsetWidth));
}
function regionStep(r, d) {
  const i = RZ.indexOf(ui.zoom[r] || 100);
  setRegionZoom(r, d ? RZ[Math.min(RZ.length - 1, Math.max(0, i + d))] : 100);
}
const paneSize = id => ui.termZoom[id] || ui.termFont;
const panePct = id => Math.round(paneSize(id) / ui.termFont * 100);
const slotOf = id => [...$$('#slots > .slot')].find(x => x.dataset.sid === id);
function setPaneSize(id, n) {
  if (!n || n === ui.termFont) delete ui.termZoom[id]; else ui.termZoom[id] = n;
  saveUi();
  Terminals.setSize(id);
  renderPaneHeads(); renderZoom();
  const s = sessionById(id);
  hud(`${s ? s.name : 'Pane'} ${panePct(id)}%, ${paneSize(id)} px text`, slotOf(id));
}
function paneStep(id, d) {
  const cur = paneSize(id);
  const n = d > 0 ? TSIZES.find(x => x > cur) : TSIZES.slice().reverse().find(x => x < cur);
  if (n) setPaneSize(id, n); else hud(`${d > 0 ? 'Largest' : 'Smallest'} text already, ${cur} px`, slotOf(id));
}
// what a zoom gesture lands on: one pane, one part of the window, or null for the whole window
function zoomTarget(el) {
  if (!el || !el.closest) return null;
  const slot = el.closest('#slots > .slot');
  if (slot) return slot.dataset.sid ? { pane: slot.dataset.sid } : { none: true };
  if (el.closest('#activity, #sidebar')) return { region: 'side' };
  if (el.closest('#projbar, #tabbar')) return { region: 'top' };
  if (el.closest('#status')) return { region: 'status' };
  if (el.closest('#home')) return { region: 'home' };
  return null;
}
function zoomAt(t, d) {
  if (!t) { if (d) zoomStep(d); else setScale(1); return; }
  if (t.none) { hud('Empty pane: put a session in it to size its text'); return; }
  if (t.pane) { if (d) paneStep(t.pane, d); else setPaneSize(t.pane, null); return; }
  regionStep(t.region, d);
}
const focusedId = () => { if (!ui.current) return null; const v = view(ui.current), id = v.slots[v.focus]; return id && sessionById(id) ? id : null; };
// the keys follow focus: the terminal you type in, or the part a focused button sits in
function zoomKey(d) {
  let t = zoomTarget(document.activeElement);
  if (!t || t.none) { const id = focusedId(); if (id) t = { pane: id }; }
  zoomAt(t, d);
}
const zoomCount = () => Object.keys(ui.zoom).length + Object.keys(ui.termZoom).length;
function resetAllZoom() {
  ui.zoom = {}; ui.termZoom = {}; saveUi();
  Terminals.setFontSize(ui.termFont);
  applyZoom(); renderPaneHeads();
  setScale(1); renderShell();
  hud('Everything back to 100%');
}
function renderZoom() {
  const f = ui.uiScale || 1;
  Dom.text($('#zoom-val'), `${Math.round(f * 100)}%`);
  $('#zoom-val').classList.toggle('on', f !== 1);
  $('#zoom-out').disabled = f <= SCALES[0];
  $('#zoom-in').disabled = f >= SCALES[SCALES.length - 1];
  const n = zoomCount(), za = $('#zoom-all');
  za.hidden = !n; Dom.text(za, n ? `${n} part${n === 1 ? '' : 's'} zoomed, reset` : '');
}
// Ctrl+wheel zooms what is under the pointer; caught before xterm, which would scroll the terminal or send the wheel to the program in it.
// A mouse notch is 100 px of delta, a touchpad pinch sends many small ones, so steps are taken per 50 px.
let wheelAcc = 0, wheelAt = 0;
window.addEventListener('wheel', e => {
  if (!e.ctrlKey || e.altKey || e.metaKey) return;
  e.preventDefault(); e.stopImmediatePropagation();
  const t = performance.now(); if (t - wheelAt > 400) wheelAcc = 0; wheelAt = t;
  wheelAcc += e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
  if (Math.abs(wheelAcc) < 50) return;
  zoomAt(zoomTarget(e.target), wheelAcc < 0 ? 1 : -1); wheelAcc = 0;
}, { capture: true, passive: false });
$('#zoom-in').onclick = () => zoomStep(1);
$('#zoom-out').onclick = () => zoomStep(-1);
$('#zoom-val').onclick = () => setScale(1);
$('#zoom-all').onclick = resetAllZoom;
$('#zoom-all-set').onclick = resetAllZoom;
function setTermFont(n) {
  if (!TSIZES.includes(n)) n = 14;
  ui.termFont = n; saveUi();
  Terminals.setFontSize(n);
  renderShell(); renderPaneHeads();
}
$('#scale-seg').addEventListener('click', e => { const b = e.target.closest('button'); if (b) setScale(Number(b.dataset.scale)); });
$('#tfont-seg').addEventListener('click', e => { const b = e.target.closest('button'); if (b) setTermFont(Number(b.dataset.font)); });

// the keys card: the same list as in Settings, shown over the window on Ctrl+/ or F1
let keysBack = null;
const keysPop = {
  isOpen: () => !$('#keys').hidden,
  open: o => {
    const el = $('#keys');
    if (o) {
      for (const p of POPS) if (p !== keysPop && p.isOpen()) p.open(false);
      if (!el.hidden) return;
      const body = $('#keys-body'); if (!body.children.length) body.appendChild($('#keys-dl').cloneNode(true)).removeAttribute('id');
      keysBack = document.activeElement; el.hidden = false; $('#keys-close').focus();
    } else {
      if (el.hidden) return;
      el.hidden = true;
      const back = keysBack; keysBack = null;
      if (back && back.isConnected && back !== document.body) back.focus();
      else { const v = view(ui.current); if (v.slots[v.focus]) Terminals.focus(v.slots[v.focus]); }
    }
  },
};
POPS.push(keysPop);
function toggleKeys() { keysPop.open(!keysPop.isOpen()); }
$('#keys-btn').onclick = () => keysPop.open(true);
$('#cmd-btn').onclick = () => openPalette('commands');
$('#keys-show').onclick = () => keysPop.open(true);
$('#keys-close').onclick = () => keysPop.open(false);
$('#keys').addEventListener('mousedown', e => { if (e.target === e.currentTarget) keysPop.open(false); });
$('#keys').addEventListener('keydown', e => { if (e.key === 'Tab') e.preventDefault(); });

// settings: setup block, from snap.setup; a path set by a DESK_* variable cannot be changed here
function renderSetup() {
  const su = snap && snap.setup; if (!su) return;
  const put = (id, btn, val, missing, env, name) => {
    Dom.text($(id), val ? val + (env ? ` (from ${name})` : '') : missing);
    $(id).classList.toggle('bad', !val);
    const b = $(btn); if (b) { b.disabled = !!env; Dom.attr(b, 'title', env ? `${name} is set, so this cannot be changed here` : null); }
  };
  put('#set-projects', '#set-projects-btn', su.projectsRoot, 'not set', su.env.projects, 'DESK_PROJECTS');
  put('#set-claude', '#set-claude-btn', su.claudeExe, 'not found', su.env.claude, 'DESK_CLAUDE');
  put('#set-pwsh', '#set-pwsh-btn', su.pwsh, 'not found', su.env.pwsh, 'DESK_PWSH');
  if (typeof AccountsUI !== 'undefined') { AccountsUI.render($('#acc-list')); renderContext(); renderLook(); }
  for (const b of $('#resume-seg').children) b.classList.toggle('on', b.dataset.resume === (su.resume || 'current'));
  for (const b of $('#gpu-seg').children) b.classList.toggle('on', b.dataset.gpu === (su.gpu || 'on'));
  const st = su.start;
  Dom.text($('#resume-note'), st ? `This start: ${st.started} of ${st.saved} saved PC session${st.saved === 1 ? '' : 's'} started, ${st.waiting} waiting with Resume. A change applies at the next start.` : '');
}
$('#resume-seg').addEventListener('click', async e => {
  const b = e.target.closest('button'); if (!b) return;
  snap = Object.assign(snap || {}, { setup: (await desk.setSettings({ resume: b.dataset.resume })).setup });
  renderSetup();
  toast(b.dataset.resume === 'all' ? 'Every saved session starts with Desk from the next start' : b.dataset.resume === 'none' ? 'No saved session starts with Desk from the next start' : 'Only the open panes start with Desk from the next start');
});
$('#gpu-seg').addEventListener('click', async e => {
  const b = e.target.closest('button'); if (!b) return;
  snap = Object.assign(snap || {}, { setup: (await desk.setSettings({ gpu: b.dataset.gpu })).setup });
  renderSetup();
  toast(b.dataset.gpu === 'off' ? 'Software painting from the next start' : 'GPU painting from the next start');
});
async function changePath(what, key, from, msg) {
  const p = await desk.pickPath(what, from || undefined);
  if (!p) return;
  snap = Object.assign(snap || {}, { setup: (await desk.setSettings({ [key]: p })).setup });
  renderSetup(); renderHome();
  toast(msg);
}
$('#set-projects-btn').onclick = () => changePath('folder', 'projectsRoot', snap.setup && snap.setup.projectsRoot, 'Projects folder set');
$('#set-claude-btn').onclick = () => changePath('file', 'claudeExe', null, 'Claude Code path set. New sessions use it');
$('#set-pwsh-btn').onclick = () => changePath('file', 'pwsh', null, 'Shell path set. New shells use it');
$('#open-state').onclick = () => desk.openPath('state');
$('#acc-add').onclick = () => AccountsUI.add();
$('#acc-setup').onclick = () => { snap.setup.firstRun = true; Welcome.resume(); };
$('#open-log').onclick = () => desk.openPath('log');
function focusPane(i) {
  if (!ui.current) return;
  const v = view(ui.current);
  if (i >= v.n) return;
  focusSlot(i);
  if (v.slots[i]) Terminals.focus(v.slots[i]);
}
// next or previous session into the focused pane, skipping ones already shown in another pane
function cycleTab(dir) {
  const p = currentProject(); if (!p) return;
  const v = view(ui.current);
  const cur = v.slots[v.focus];
  const shownElsewhere = new Set(v.slots.slice(0, v.n).filter((id, j) => id && j !== v.focus));
  const list = snap.sessions.filter(s => s.machine === p.machine && s.project === p.dir && !shownElsewhere.has(s.id)).sort((a, b) => a.order - b.order);
  if (!list.length) return;
  const idx = list.findIndex(s => s.id === cur);
  const next = list[((idx < 0 ? (dir > 0 ? -1 : 0) : idx) + dir + list.length) % list.length];
  if (next && next.id !== cur) placeInSlot(next.id, v.focus);
}

function setSplit(n) {
  const v = view(ui.current);
  v.n = n;
  if (v.focus >= n) v.focus = n - 1;
  saveUi();
  renderSlots(); renderTabs(); renderSidebar(true);
}

// account and pane are optional: the chip's account, and the first empty pane or else the focused one
async function newSession(kind, pick, slotAt) {
  const p = currentProject();
  if (!p) return;
  const account = kind === 'shell' ? 0 : (pick || currentAccount());
  if (p.machine === 'laptop' && snap.laptop.status !== 'online') { toast('Laptop is offline', 'error'); return; }
  if (kind !== 'shell') { ui.lastAccount[p.machine] = account; }
  const s = await desk.startSession({ machine: p.machine, project: p.dir, account, kind });
  snap.sessions.push(s);
  const v = view(ui.current);
  let slot = slotAt ?? v.slots.indexOf(null);
  if (slot < 0 || slot >= v.n) slot = v.focus;
  placeInSlot(s.id, slot);
}
function emptyPane(i) {
  view(ui.current).slots[i] = null;
  saveUi(); renderSlots(); renderTabs(); renderSidebar(true);
}
// the panes after it move up one; its session, if any, stays running as a tab
function closePane(i) {
  const v = view(ui.current);
  if (v.n < 2) return emptyPane(i);
  v.slots.splice(i, 1); v.slots.push(null); v.n--;
  if (v.focus > i || v.focus >= v.n) v.focus = Math.max(0, v.focus - 1);
  saveUi(); renderSlots(); renderTabs(); renderSidebar(true);
}

async function forget(id) {
  await desk.forgetSession(id);
  Terminals.dispose(id);
  delete ui.termZoom[id];
  for (const v of Object.values(ui.views)) if (v.slots) v.slots = v.slots.map(x => x === id ? null : x);
  saveUi();
  if (snap) snap.sessions = snap.sessions.filter(s => s.id !== id);
  renderAll(); renderSlots();
}

// ---------- command palette: Ctrl+K commands, Ctrl+P jump, and say with its preview; one overlay, three modes ----------
const PAL = { mode: null, items: [], sel: 0, back: null, sayTo: new Set() };
// projects with at least one Claude session, so a say could reach something
const claudeProjects = () => snap ? snap.projects.filter(p => snap.sessions.some(s => s.machine === p.machine && s.project === p.dir && s.kind !== 'shell')) : [];
const pname = () => { const p = currentProject(); return p ? p.name : 'this project'; };
function showNav(n) { if (ui.nav !== n) setNav(n); else if ((ui.sidebar.collapsed || ui.sidebar.hidden) && (n === 'projects' || n === 'settings')) toggleSidebar(); }
function setTheme(t) { ui.theme = t; saveUi(); applyTheme(); renderShell(); }
const inProject = () => !!currentProject();
const COMMANDS = [
  { id: 'say', name: 'Say to Claude sessions', sub: 'one message to the idle Claude sessions in the projects you tick', when: () => claudeProjects().length > 0, run: () => openPalette('say') },
  { id: 'new', name: 'New Claude session', key: 'Ctrl+Shift+N', sub: () => `as ${accName(currentAccount())} in ${pname()}`, when: inProject, run: () => newSession('claude') },
  { id: 'shell', name: 'New shell', key: 'Ctrl+Shift+T', sub: () => `a plain terminal in ${pname()}`, when: inProject, run: () => newSession('shell') },
  { id: 'addpc', name: 'Add a folder', sub: 'pick any folder on this PC to work in', run: () => desk.addProject('pc', null) },
  { id: 'addlaptop', name: 'Add a laptop folder', sub: 'type its path', when: () => !!(snap && snap.laptop && snap.laptop.status === 'online'), run: () => openPalette('folder') },
  ...['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight'].map((w, i) => ({ id: 'split' + (i + 1), name: `${w} pane${i ? 's' : ''}`, key: `Ctrl+Shift+${i + 1}`, when: inProject, run: () => setSplit(i + 1) })),
  { id: 'sidebar', name: () => ui.sidebar.collapsed ? 'Show the sidebar' : 'Hide the sidebar', key: 'Ctrl+B', run: () => toggleSidebar() },
  { id: 'panel', name: () => ui.sidebar.hidden ? 'Show the left panel' : 'Hide the left panel', sub: 'the icons and the sidebar together', key: 'Ctrl+Shift+B', run: () => togglePanel() },
  { id: 'home', name: 'Desk home', sub: 'every session, the ones that need you first', run: () => showNav('home') },
  { id: 'projects', name: 'Projects', sub: 'the sidebar list', run: () => showNav('projects') },
  { id: 'attention', name: 'Needs you', sub: () => { const n = snap ? snap.sessions.filter(ATTN).length : 0; return n ? `${n} waiting` : 'nothing waiting'; }, run: () => showNav('attention') },
  { id: 'settings', name: 'Settings', key: 'Ctrl+,', run: () => showNav('settings') },
  { id: 'keys', name: 'Keys', sub: 'every shortcut on one card', key: 'Ctrl+/', run: () => keysPop.open(true) },
  { id: 'zoom-in', name: 'Zoom the window in', sub: () => `now ${Math.round((ui.uiScale || 1) * 100)}%, everything at once`, key: 'Ctrl+Shift+=', when: () => (ui.uiScale || 1) < SCALES[SCALES.length - 1], run: () => zoomStep(1) },
  { id: 'zoom-out', name: 'Zoom the window out', sub: () => `now ${Math.round((ui.uiScale || 1) * 100)}%, everything at once`, key: 'Ctrl+Shift+-', when: () => (ui.uiScale || 1) > SCALES[0], run: () => zoomStep(-1) },
  { id: 'zoom-reset', name: 'Window zoom back to 100%', key: 'Ctrl+Shift+0', when: () => (ui.uiScale || 1) !== 1, run: () => setScale(1) },
  { id: 'zoom-all', name: 'Reset every zoom', sub: 'the window, the sidebar, the bars, home and every terminal back to 100%', when: () => zoomCount() > 0 || (ui.uiScale || 1) !== 1, run: () => resetAllZoom() },
  { id: 'pane-in', name: 'Bigger text in this pane', sub: () => `${focusedId() ? panePct(focusedId()) : 100}% now, the other panes stay`, key: 'Ctrl+=', when: focusedId, run: () => paneStep(focusedId(), 1) },
  { id: 'pane-out', name: 'Smaller text in this pane', sub: () => `${focusedId() ? panePct(focusedId()) : 100}% now, the other panes stay`, key: 'Ctrl+-', when: focusedId, run: () => paneStep(focusedId(), -1) },
  { id: 'pane-reset', name: 'This pane back to the default text size', key: 'Ctrl+0', when: () => { const id = focusedId(); return !!(id && ui.termZoom[id]); }, run: () => setPaneSize(focusedId(), null) },
  ...[12, 13, 14, 16, 18].map(n => ({ id: 'tfont' + n, name: `Terminal text: ${n}`, sub: 'every terminal not sized on its own', when: () => (ui.termFont || 14) !== n, run: () => setTermFont(n) })),
  { id: 'open-log', name: 'Open the log', sub: 'state/desk.log, what Desk did and why', run: () => desk.openPath('log') },
  { id: 'open-state', name: 'Open the state folder', sub: 'settings, layout and the log', run: () => desk.openPath('state') },
  { id: 'theme-system', name: 'Theme: follow Windows', when: () => !!ui.theme, run: () => setTheme('') },
  { id: 'theme-light', name: 'Theme: light', when: () => ui.theme !== 'light', run: () => setTheme('light') },
  { id: 'theme-dark', name: 'Theme: dark', when: () => ui.theme !== 'dark', run: () => setTheme('dark') },
  { id: 'flash', name: () => ui.flash !== false ? 'Taskbar flash: turn off' : 'Taskbar flash: turn on', run: () => { ui.flash = ui.flash === false; saveUi(); renderShell(); } },
  { id: 'mem-now', name: 'Sample memory now', run: () => $('#mem-now').click() },
  { id: 'mem', name: () => ui.showMem ? 'Hide memory per session' : 'Show memory per session', run: () => $('#mem-toggle').click() },
  { id: 'sb-reset', name: 'Reset sidebar width', run: () => $('#sb-reset').click() },
];
const val = v => typeof v === 'function' ? v() : (v || '');
// subsequence match, case blind; a run of consecutive hits and a hit at a word start score higher, a long gap lower
function fuzzy(hay, q) {
  const h = hay.toLowerCase(), n = q.toLowerCase().replace(/\s+/g, '');
  if (!n) return { score: 0, idx: [] };
  const idx = []; let from = 0, score = 0, prev = -2;
  for (const ch of n) {
    const j = h.indexOf(ch, from);
    if (j < 0) return null;
    score += 1 + (j === prev + 1 ? 2 : 0) + (j === 0 || /[\s\-_:./\\]/.test(h[j - 1]) ? 3 : 0) - Math.min(3, j - from) * 0.2;
    idx.push(j); prev = j; from = j + 1;
  }
  return { score: score - h.length * 0.01, idx };
}
function markText(el, text, idx) {
  el.textContent = '';
  if (!idx || !idx.length) { el.textContent = text; return; }
  const hit = new Set(idx);
  let run = '', inMark = hit.has(0);
  const flush = () => { if (!run) return; el.appendChild(inMark ? Dom.h('mark', null, run) : document.createTextNode(run)); run = ''; };
  for (let i = 0; i < text.length; i++) { if (hit.has(i) !== inMark) { flush(); inMark = hit.has(i); } run += text[i]; }
  flush();
}
// the same rule main applies in sayToProject: claude sessions of the project, live, not working or waiting
const sayWhy = s => s.status !== 'live' ? s.status : (s.state === 'working' || s.state === 'waiting') ? s.state : '';
function palItems(mode) {
  const bySession = s => { const p = projectByKey(s.machine + ':' + s.project); return { p, name: p ? p.name : s.project }; };
  if (mode === 'folder') return [];
  if (mode === 'say') {
    const projs = claudeProjects(), items = [];
    if (projs.length > 1) items.push({ k: 'sa', kind: 'sayall', name: 'All projects', sub: `${projs.length} projects have Claude sessions`, on: projs.every(p => PAL.sayTo.has(p.key)), hay: '' });
    for (const p of projs) {
      const ss = snap.sessions.filter(s => s.machine === p.machine && s.project === p.dir && s.kind !== 'shell').sort((x, y) => x.order - y.order);
      const idle = ss.filter(s => !sayWhy(s)).length, on = PAL.sayTo.has(p.key);
      items.push({ k: 'sp:' + p.key, kind: 'sayproj', key: p.key, name: p.name + (p.machine === 'laptop' ? ' (laptop)' : ''), sub: `${idle} of ${ss.length} can take it now`, rt: p.key === ui.current ? 'open now' : '', on, hay: '' });
      if (on) for (const s of ss) { const why = sayWhy(s); items.push({ k: 's:' + s.id, kind: 'say', name: s.name, sub: s.label || STATE_WORD[stateOf(s)] || '', rt: why ? `skipped, ${why}` : 'will send', will: !why, acc: s.account, hay: s.name }); }
    }
    return items;
  }
  const cmds = COMMANDS.filter(c => !c.when || c.when()).map(c => ({ k: 'c:' + c.id, kind: 'cmd', name: val(c.name), sub: val(c.sub), rt: c.key || '', hay: val(c.name), run: c.run }));
  const projs = (snap ? snap.projects : []).map(p => {
    const n = snap.sessions.filter(s => s.machine === p.machine && s.project === p.dir).length;
    const name = (mode === 'commands' ? 'Open ' : '') + p.name;
    return { k: 'p:' + p.key, kind: 'proj', name, sub: p.dir + (p.machine === 'laptop' ? ' (laptop)' : ''), rt: n ? `${n} session${n === 1 ? '' : 's'}` : '', hay: name, run: () => showProject(p.key) };
  });
  const attnFirst = (x, y) => (ATTN(y) - ATTN(x)) || (x.machine + x.project).localeCompare(y.machine + y.project) || (x.order - y.order);
  const sess = (snap ? snap.sessions.slice().sort(attnFirst) : []).map(s => {
    const b = bySession(s);
    return { k: 's:' + s.id, kind: 'sess', name: s.name, sub: b.name + (s.machine === 'laptop' ? ' (laptop)' : ''), rt: STATE_WORD[stateOf(s)] || stateOf(s), acc: s.account, hay: s.name + ' ' + b.name, run: () => H.onSession(s) };
  });
  return mode === 'commands' ? cmds.concat(projs, sess) : sess.concat(projs);
}
const svgUse = id => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('class', 'g'); const u = document.createElementNS('http://www.w3.org/2000/svg', 'use'); u.setAttribute('href', '#' + id); s.appendChild(u); return s; };
function palMode() { const raw = $('#pal-input').value; return PAL.mode === 'say' || PAL.mode === 'folder' ? PAL.mode : raw.startsWith('>') ? 'commands' : PAL.mode; }
function renderPalette() {
  const pal = $('#palette');
  if (pal.hidden) return;
  const mode = palMode();
  const q = mode === 'say' || mode === 'folder' ? '' : $('#pal-input').value.replace(/^>/, '').trim();
  let items = palItems(mode);
  if (q) items = items.map((it, i) => ({ it, m: fuzzy(it.hay, q), i })).filter(x => x.m).sort((x, y) => (y.m.score - x.m.score) || (x.i - y.i)).map(x => Object.assign(x.it, { idx: x.m.idx }));
  if (!items.length) items = [{ k: 'none', kind: 'none', name: mode === 'say' ? 'No Claude session in any project. Start one with the session button.' : mode === 'folder' ? 'Type the absolute path of a folder on the laptop, then press Enter' : 'Nothing matches' }];
  PAL.items = items;
  PAL.sel = Math.min(PAL.sel, items.length - 1);
  const list = $('#pal-list');
  Dom.keyed(list, items, it => it.k, it => {
    if (it.kind === 'none') return Dom.h('div', 'none', it.name);
    const r = Dom.h('div', 'row ' + it.kind); r.setAttribute('role', 'option');
    const box = it.kind === 'sayproj' || it.kind === 'sayall';
    if (box) r.setAttribute('aria-checked', 'false');
    if (it.acc != null) r.appendChild(Dom.h('span', 'acc')); else { const ic = Dom.h('span', box ? 'ic box' : 'ic'); ic.appendChild(svgUse(box ? 'i-check' : it.kind === 'proj' ? 'i-folder' : 'i-cmd')); r.appendChild(ic); }
    const t = Dom.h('span', 'txt'); t.appendChild(Dom.h('span', 'nm')); t.appendChild(Dom.h('span', 'role')); r.appendChild(t);
    r.appendChild(Dom.h('span', 'lt'));
    return r;
  }, (r, it) => {
    if (it.kind === 'none') { Dom.text(r, it.name); return; }
    if (it.acc != null) setAccChip(r.firstChild, it.acc);
    markText(r.children[1].firstChild, it.name, it.idx);
    Dom.text(r.children[1].lastChild, it.sub || '');
    r.children[1].lastChild.hidden = !it.sub;
    Dom.text(r.lastChild, it.rt || '');
    r.classList.toggle('will', !!it.will); r.classList.toggle('skip', it.kind === 'say' && !it.will);
    r.classList.toggle('ticked', !!it.on);
    if (it.kind === 'sayproj' || it.kind === 'sayall') r.setAttribute('aria-checked', it.on ? 'true' : 'false');
  }, { sig: it => JSON.stringify([it.name, it.sub, it.rt, it.acc, it.idx, it.will, it.on]), force: true });
  // a filtered list is not a list that changed on its own: rows that go, go now
  for (const r of [...list.children]) if (Dom.isLeaving(r)) r.remove();
  for (const [i, r] of [...list.children].entries()) { r.classList.toggle('on', i === PAL.sel); r.setAttribute('aria-selected', i === PAL.sel ? 'true' : 'false'); }
  const on = list.children[PAL.sel]; if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest' });
  const foot = $('#pal-foot'); foot.textContent = '';
  const add = (txt, cls) => foot.appendChild(Dom.h('span', cls, txt));
  if (mode === 'folder') { add('Enter adds the folder'); add('Esc closes'); }
  else if (mode === 'say') {
    const ticked = items.filter(it => it.kind === 'sayproj' && it.on).length;
    const n = items.filter(it => it.will).length, m = items.filter(it => it.kind === 'say').length;
    if (!items.some(it => it.kind === 'sayproj')) add('Nothing to send to');
    else if (!ticked) add('Tick a project to send to', 'warn');
    else if (!n) add(`None of the ${m} can take a message now: working and waiting sessions are skipped`, 'warn');
    else add(`Enter sends to ${n} of ${m} in ${ticked} project${ticked === 1 ? '' : 's'}`);
    add('Click or Tab ticks a project');
    add('Esc closes');
  } else {
    add(mode === 'commands' ? 'Up and Down pick, Enter runs' : 'Up and Down pick, Enter opens');
    add(mode === 'commands' ? 'Ctrl+P jumps to a session' : 'Type > for commands');
    add('Esc closes');
  }
}
const palPop = { isOpen: () => !$('#palette').hidden, open: o => o ? openPalette('commands') : closePalette() };
POPS.push(palPop);
function openPalette(mode) {
  const pal = $('#palette'), inp = $('#pal-input');
  for (const p of POPS) if (p !== palPop && p.isOpen()) p.open(false);
  // say starts with the open project ticked, or the only project there is
  if (mode === 'say' && (pal.hidden || PAL.mode !== 'say')) {
    const cp = claudeProjects();
    PAL.sayTo = new Set(cp.some(p => p.key === ui.current) ? [ui.current] : cp.length === 1 ? [cp[0].key] : []);
  }
  if (pal.hidden) { PAL.back = document.activeElement; pal.hidden = false; inp.value = ''; }
  else if (PAL.mode !== mode) inp.value = '';
  PAL.mode = mode; PAL.sel = 0;
  Dom.text($('#pal-mode'), mode === 'say' ? 'Say' : mode === 'jump' ? 'Go to' : mode === 'folder' ? 'Add folder' : 'Command');
  inp.placeholder = mode === 'say' ? 'Message for the idle Claude sessions in the ticked projects' : mode === 'jump' ? 'Session or project name' : mode === 'folder' ? '/home/you/project' : 'Command, project or session';
  renderPalette();
  inp.focus();
}
function closePalette() {
  const pal = $('#palette');
  if (pal.hidden) return;
  pal.hidden = true;
  const back = PAL.back; PAL.back = null; PAL.mode = null;
  if (back && back.isConnected && back !== document.body) back.focus();
  else { const v = view(ui.current); if (v.slots[v.focus]) Terminals.focus(v.slots[v.focus]); }
}
function palMove(d) {
  const n = PAL.items.length; if (!n) return;
  PAL.sel = (PAL.sel + d + n) % n;
  const list = $('#pal-list');
  for (const [i, r] of [...list.children].entries()) { r.classList.toggle('on', i === PAL.sel); r.setAttribute('aria-selected', i === PAL.sel ? 'true' : 'false'); }
  const on = list.children[PAL.sel]; if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest' });
}
function palRun() {
  if (palMode() === 'say') { sendSay(); return; }
  if (palMode() === 'folder') { addLaptopFolder(); return; }
  const it = PAL.items[PAL.sel];
  if (!it || !it.run) return;
  closePalette();
  it.run();
}
async function addLaptopFolder() {
  const dir = $('#pal-input').value.trim();
  if (!dir) return;
  closePalette();
  await desk.addProject('laptop', dir);
}
function toggleSay(it) {
  if (!it) return false;
  if (it.kind === 'sayall') { const all = claudeProjects().map(p => p.key); PAL.sayTo = new Set(all.every(k => PAL.sayTo.has(k)) ? [] : all); }
  else if (it.kind === 'sayproj') { if (PAL.sayTo.has(it.key)) PAL.sayTo.delete(it.key); else PAL.sayTo.add(it.key); }
  else return false;
  renderPalette();
  return true;
}
async function sendSay() {
  const text = $('#pal-input').value.trim();
  const keys = [...PAL.sayTo].filter(k => projectByKey(k));
  if (!text) return;
  if (!keys.length) { toast('Tick a project to send to', 'error'); return; }
  if (!PAL.items.some(it => it.will)) { toast('No idle Claude session in the ticked projects to say that to', 'error'); return; }
  closePalette();
  const r = { sent: [], skipped: [] };
  for (const k of keys) { const x = await desk.say(k, text); r.sent.push(...x.sent); r.skipped.push(...x.skipped); }
  const skipped = r.skipped.map(s => `${s.name} (${s.why})`).join(', ');
  if (r.sent.length) toast(`Said to ${r.sent.join(', ')}` + (skipped ? `. Skipped ${skipped}` : ''));
  else toast('Nothing sent' + (skipped ? `: skipped ${skipped}` : ''), 'error');
}
$('#pal-input').addEventListener('input', () => { PAL.sel = 0; renderPalette(); });
$('#pal-input').addEventListener('keydown', e => {
  if (e.key === 'ArrowDown') { e.preventDefault(); palMove(1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); palMove(-1); }
  else if (e.key === 'Enter') { e.preventDefault(); palRun(); }
  else if (e.key === 'Tab' && palMode() === 'say') { e.preventDefault(); toggleSay(PAL.items[PAL.sel]); }
});
$('#pal-list').addEventListener('click', e => {
  const r = e.target.closest('.row'); if (!r) return;
  PAL.sel = [...$('#pal-list').children].indexOf(r);
  if (palMode() === 'say') { toggleSay(PAL.items[PAL.sel]); $('#pal-input').focus(); return; }
  palRun();
});
$('#palette').addEventListener('mousedown', e => { if (e.target === e.currentTarget) closePalette(); });
$('#say-btn').onclick = () => openPalette('say');

// ---------- wiring ----------
async function init() {
  snap = await desk.init();
  ui = Object.assign({ current: null, views: {}, expanded: {}, lastAccount: {}, nav: 'projects', theme: '', sidebar: null, zoom: {}, termZoom: {} }, snap.ui || {});
  ui.views = ui.views || {}; ui.expanded = ui.expanded || {}; ui.lastAccount = ui.lastAccount || {}; ui.picker = ui.picker || {}; ui.showMem = !!ui.showMem;
  ui.flash = ui.flash !== false; ui.notify = !!ui.notify;
  ui.sidebar = Object.assign({ w: 300, collapsed: false, hidden: false }, ui.sidebar || {});
  ui.sidebar.w = Math.min(480, Math.max(220, Number(ui.sidebar.w) || 300));
  ui.uiScale = nearestScale(Number(ui.uiScale) || 1);
  // 13 in Consolas was the old default; the new one is 14 in Cascadia Mono, moved over once
  if (!ui.textV) { if (Number(ui.termFont) === 13) ui.termFont = 14; ui.textV = 2; }
  ui.termFont = TSIZES.includes(Number(ui.termFont)) ? Number(ui.termFont) : 14;
  ui.zoom = ui.zoom && typeof ui.zoom === 'object' ? ui.zoom : {};
  for (const r of Object.keys(ui.zoom)) if (!REGIONS[r] || !RZ.includes(ui.zoom[r]) || ui.zoom[r] === 100) delete ui.zoom[r];
  ui.termZoom = ui.termZoom && typeof ui.termZoom === 'object' ? ui.termZoom : {};
  for (const id of Object.keys(ui.termZoom)) if (!TSIZES.includes(ui.termZoom[id]) || !snap.sessions.some(s => s.id === id)) delete ui.termZoom[id];
  if (ui.uiScale !== 1) desk.zoom(ui.uiScale);
  Terminals.setSizer(id => ui.termZoom[id] || ui.termFont);
  Terminals.setFontSize(ui.termFont);
  applyZoom();
  // xterm measures the cell once when a terminal opens, so the font has to be in before the first one
  try { await document.fonts.load(`${ui.termFont}px "Cascadia Mono"`); } catch { /* falls back to Consolas */ }
  if (ui.current && !projectByKey(ui.current)) ui.current = null;
  applyTheme();
  applyAccountColours();
  renderAll();
  document.documentElement.dataset.ready = '1';
  if (ui.current) renderSlots();
  Terminals.setFontFamily(ui.termFamily);
  Welcome.check();
}

desk.onSnapshot(s => {
  snap = s;
  applyAccountColours();
  if (ui.current && !projectByKey(ui.current)) { ui.current = null; renderSlots(); }
  renderAll();
  notifyTransitions();
  Welcome.check();
});
desk.onData((id, d) => Terminals.write(id, d));
// what the overlay says when a session ends, from the exit code; the shell keeps its last screen behind it
function exitCopy(s, e) {
  const code = e && e.exitCode != null ? e.exitCode : null;
  const shell = s && s.kind === 'shell';
  const who = shell ? 'The shell' : 'Claude';
  const again = shell ? 'Resume opens a new shell in this folder.' : 'Resume picks the conversation up where it stopped.';
  if (s && s.machine === 'laptop') return { title: 'The laptop connection dropped', detail: `The session may still be running there. Resume reattaches to it.${code != null ? ` Exit code ${code}.` : ''}` };
  if (code === 0) return { title: `${who} ended`, detail: `Exit code 0. ${again}` };
  if (code === 130 || code === -1073741510) return { title: `${who} was interrupted`, detail: `Exit code ${code}, a Ctrl+C or a stop. ${again}` };
  if (code != null) return { title: `${who} ended with an error`, detail: `Exit code ${code}. What it printed last is above. ${again}` };
  return { title: `${who} ended`, detail: `No exit code was reported. ${again}` };
}
// a saved session that Desk did not start (the Start setting) shows this until Resume is clicked
function notStartedCopy(s) {
  const su = snap && snap.setup && snap.setup.start;
  const why = su && su.policy === 'none' ? 'Desk starts no saved session (Settings, Start).' : 'Desk starts only the panes of the project it was last on (Settings, Start).';
  return { title: s.kind === 'shell' ? 'Shell not started' : 'Not started', detail: `${why} ${s.kind === 'shell' ? 'Resume opens a new shell in this folder.' : 'Resume picks the conversation up where it stopped.'}` };
}
desk.onExit((id, e) => Terminals.overlay(id, exitCopy(sessionById(id), e), true));
desk.onStarted(id => Terminals.restarted(id));
desk.onToast((msg, kind) => toast(msg, kind));

$('#new-shell').onclick = () => newSession('shell');
$('#mem-now').onclick = async () => { $('#mem-now').disabled = true; snap = await desk.memoryNow(); renderAll(); $('#mem-now').disabled = false; };
$('#mem-toggle').onclick = () => { ui.showMem = !ui.showMem; saveUi(); renderMemToggle(); renderSidebar(); };
function renderMemToggle() {
  const b = $('#mem-toggle');
  b.classList.toggle('on', !!ui.showMem);
  Dom.attr(b, 'title', ui.showMem ? 'Hide memory per session in the sidebar' : 'Show memory per session in the sidebar');
}
let typingTimer = null;
document.addEventListener('keydown', e => {
  if (!e.target.closest || !e.target.closest('.termwrap')) return;
  document.body.classList.add('typing');
  clearTimeout(typingTimer);
  typingTimer = setTimeout(() => document.body.classList.remove('typing'), 1500);
}, true);
let fitTimer = null;
new ResizeObserver(() => { clearTimeout(fitTimer); fitTimer = setTimeout(Terminals.fitAll, 80); }).observe($('#slots'));
window.addEventListener('resize', () => { clearTimeout(fitTimer); fitTimer = setTimeout(Terminals.fitAll, 80); });

init().catch(e => toast('init failed: ' + e.message, 'error'));
