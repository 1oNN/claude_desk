// First-run setup and the account and appearance editors it shares with Settings. Uses app.js globals at call time.
const ACCENTS = ['#C4182F', '#D9822B', '#2E9E5B', '#1F7AE0', '#7B5CE0', '#D6409F'];
const TERM_FONTS = ['Cascadia Mono', 'Consolas', 'JetBrains Mono', 'Fira Code', 'Lucida Console'];

// ---------- accounts editor ----------
const AccountsUI = (() => {
  let sigs = new WeakMap();
  function row(a) {
    const r = Dom.h('div', 'acc-edit');
    r.dataset.id = a.id;
    const sw = Dom.h('input'); sw.type = 'color'; sw.value = a.colour; sw.className = 'acc-colour';
    sw.setAttribute('aria-label', `Colour of ${a.name}`);
    sw.onchange = () => save(a.id, { colour: sw.value });
    const name = Dom.h('input'); name.value = a.name; name.maxLength = 24; name.className = 'acc-name';
    name.setAttribute('aria-label', 'Account name');
    name.onchange = () => save(a.id, { name: name.value });
    const role = Dom.h('input'); role.value = a.role || ''; role.maxLength = 40; role.placeholder = 'role (optional)'; role.className = 'acc-role';
    role.setAttribute('aria-label', `Role of ${a.name}`);
    role.onchange = () => save(a.id, { role: role.value });
    const st = Dom.h('span', 'acc-st ' + (a.signedIn ? 'ok' : 'bad'), a.signedIn ? (a.email ? `Signed in as ${a.email}` : 'Signed in') : 'Not signed in yet');
    const btns = Dom.h('span', 'acc-btns');
    if (!a.signedIn) { const b = Dom.h('button', 'primary', 'Sign in'); b.onclick = () => signIn(a.id); btns.appendChild(b); }
    const f = Dom.h('button', null, 'Folder'); f.title = a.dir; f.onclick = () => desk.openPath('account:' + a.id); btns.appendChild(f);
    if ((snap.accountList || []).length > 1) {
      const x = Dom.h('button', null, 'Remove'); x.title = 'Desk forgets it; the folder and its sign-in stay on disk';
      x.onclick = async () => { if (!confirm(`Remove ${a.name} from Desk? Its folder stays on disk.`)) return; await run(desk.accountRemove(a.id)); };
      btns.appendChild(x);
    }
    r.append(sw, name, role, st, btns);
    return r;
  }
  async function run(p) { try { const list = await p; if (Array.isArray(list)) { snap.accountList = list; applyAccountColours(); renderAll(); } return true; } catch (e) { toast(e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 'error'); return false; } }
  function save(id, patch) { return run(desk.accountUpdate(id, patch)); }
  async function add() {
    const n = (snap.accountList || []).length + 1;
    await run(desk.accountAdd({ name: `Account ${n}` }));
  }
  // Claude Code's own login runs in a pane for that account; Desk never sees the token
  async function signIn(id) {
    let p = currentProject();
    if (!p || p.machine !== 'pc') p = snap.projects.find(x => x.machine === 'pc');
    if (!p) { toast('Add a project folder first, then sign in from a pane', 'error'); return; }
    Welcome.away();
    if (ui.current !== p.key) showProject(p.key);
    await newSession('claude', id);
    toast(`Sign in to ${accName(id)} in the new pane. Its row in Settings turns green when that is done`);
  }
  // re-rendered only when something changed and nobody is typing in it
  function render(box) {
    if (!box || !snap) return;
    const list = snap.accountList || [];
    const sig = JSON.stringify(list);
    if (sigs.get(box) === sig || box.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return;
    sigs.set(box, sig);
    box.textContent = '';
    for (const a of list) box.appendChild(row(a));
  }
  return { render, add, signIn };
})();

// ---------- appearance ----------
function applyAccent() {
  const st = document.documentElement.style;
  const a = typeof ui.accent === 'string' && /^#[0-9a-f]{6}$/i.test(ui.accent) ? ui.accent : null;
  const vars = { '--accent': a, '--accent-hover': a && `color-mix(in oklab, ${a} 80%, white)`, '--link': a, '--term-cursor': a, '--term-selection': a && `color-mix(in oklab, ${a} 28%, transparent)` };
  for (const [k, v] of Object.entries(vars)) if (v) st.setProperty(k, v); else st.removeProperty(k);
}
function renderSwatches(box) {
  if (!box) return;
  const cur = ui.accent || '';
  if (box.dataset.sig === cur) return;
  box.dataset.sig = cur;
  box.textContent = '';
  const mk = (val, label) => {
    const b = Dom.h('button', 'sw' + (val === cur ? ' on' : ''));
    b.style.setProperty('--sw', val || '#C4182F');
    if (!val) b.classList.add('def');
    b.title = label; b.setAttribute('aria-label', label);
    b.onclick = () => setAccent(val);
    return b;
  };
  box.appendChild(mk('', 'Default'));
  for (const c of ACCENTS) box.appendChild(mk(c, c));
  const pick = Dom.h('input'); pick.type = 'color'; pick.className = 'sw-pick'; pick.value = /^#[0-9a-f]{6}$/i.test(cur) ? cur : '#C4182F';
  pick.setAttribute('aria-label', 'Any colour'); pick.title = 'Any colour';
  pick.onchange = () => setAccent(pick.value);
  box.appendChild(pick);
}
function setAccent(v) { ui.accent = v || ''; saveUi(); applyTheme(); renderLook(); }
function setTermFamily(f) {
  ui.termFamily = TERM_FONTS.includes(f) ? f : '';
  saveUi();
  Terminals.setFontFamily(ui.termFamily);
  renderLook();
}
function fillFontSelect(sel) {
  if (!sel) return;
  if (!sel.options.length) for (const f of TERM_FONTS) { const o = Dom.h('option', null, f); o.value = f === 'Cascadia Mono' ? '' : f; sel.appendChild(o); }
  sel.value = ui.termFamily || '';
}
function renderLook() {
  for (const box of document.querySelectorAll('.swatches')) renderSwatches(box);
  for (const sel of document.querySelectorAll('select.tfam')) fillFontSelect(sel);
  for (const seg of document.querySelectorAll('.seg.theme')) for (const b of seg.children) b.classList.toggle('on', b.dataset.theme === (ui.theme || ''));
  for (const seg of document.querySelectorAll('.seg.tsize')) for (const b of seg.children) b.classList.toggle('on', Number(b.dataset.font) === (ui.termFont || 14));
  const pv = document.getElementById('wl-preview');
  if (pv) pv.style.fontFamily = `"${ui.termFamily || 'Cascadia Mono'}", Consolas, monospace`;
  if (pv) pv.style.fontSize = (ui.termFont || 14) + 'px';
}

// ---------- context ----------
const CONTEXT_COPY = {
  off: ['Nothing', 'Desk adds nothing to the system prompt. 0 tokens.'],
  name: ['Name', 'One line: "You are <session> in Claude Desk, working in <project>." About 15 tokens.'],
  team: ['Name and team', 'The line above plus the other Desk sessions in the project, so they can refer to each other. About 15 to 40 tokens.'],
};
async function setSetting(patch, msg) {
  try { snap = Object.assign(snap || {}, { setup: (await desk.setSettings(patch)).setup }); } catch (e) { toast(e.message, 'error'); return; }
  renderContext(); renderSetup(); Welcome.render();
  if (msg) toast(msg);
}
function renderContext() {
  const su = snap && snap.setup; if (!su) return;
  for (const seg of document.querySelectorAll('.seg.context')) for (const b of seg.children) b.classList.toggle('on', b.dataset.context === su.context);
  for (const p of document.querySelectorAll('.context-note')) Dom.text(p, su.alliance ? 'The alliance prompt script sets the prompt, so this does not apply.' : CONTEXT_COPY[su.context || 'off'][1]);
  for (const c of document.querySelectorAll('input.carry')) c.checked = !!su.carryOn;
  for (const c of document.querySelectorAll('input.usage')) c.checked = su.usage !== 'off';
  for (const c of document.querySelectorAll('input.updates')) c.checked = su.updates !== 'off';
  const v = document.getElementById('upd-version'); if (v) Dom.text(v, `Claude Desk ${su.version || ''}`);
}
document.addEventListener('click', e => {
  const b = e.target.closest('.seg.context button'); if (b) { setSetting({ context: b.dataset.context }, 'Applies to sessions started from now on'); return; }
  const t = e.target.closest('.seg.theme button'); if (t) { setTheme(t.dataset.theme); renderLook(); return; }
  const f = e.target.closest('.seg.tsize button'); if (f) { setTermFont(Number(f.dataset.font)); renderLook(); }
});
document.addEventListener('change', e => {
  if (e.target.matches('input.carry')) setSetting({ carryOn: e.target.checked });
  else if (e.target.matches('input.usage')) setSetting({ usage: e.target.checked ? 'on' : 'off' }, 'Applies to sessions started from now on');
  else if (e.target.matches('select.tfam')) setTermFamily(e.target.value);
  else if (e.target.matches('input.updates')) setSetting({ updates: e.target.checked ? 'on' : 'off' }, 'Applies at the next start');
});
document.getElementById('upd-check').onclick = async () => {
  try { const r = await desk.checkUpdate(); toast(r.note || 'Desk is up to date'); } catch (e) { toast(e.message, 'error'); }
};

// ---------- the first-run setup ----------
const Welcome = (() => {
  const STEPS = ['Check', 'Accounts', 'Look', 'Context'];
  let step = 0, away = false, open = false, begun = false;
  const el = () => document.getElementById('welcome');
  function check() {
    // adding an account writes the store and ends first run; a setup already under way still runs to the end
    const want = (begun || !!(snap && snap.setup && snap.setup.firstRun)) && !away;
    if (want) begun = true;
    if (want && !open) show(true); else if (!want && open && !away) show(false);
    if (open) render();
  }
  function show(on) {
    open = on;
    el().hidden = !on;
    if (on) { render(true); requestAnimationFrame(() => { const n = document.getElementById('wl-next'); if (n) n.focus(); }); }
  }
  function stepCheck(body) {
    const su = snap.setup;
    body.appendChild(Dom.h('p', 'lede', 'Claude Desk runs Claude Code sessions side by side. It needs Claude Code, a shell, and a folder that holds your projects.'));
    const dl = Dom.h('div', 'wl-rows');
    const line = (k, v, ok, btn) => {
      const r = Dom.h('div', 'wl-row');
      r.append(Dom.h('span', 'k', k), Dom.h('span', 'v ' + (ok ? 'ok' : 'bad'), v));
      if (btn) r.appendChild(btn);
      dl.appendChild(r);
    };
    const btn = (t, fn) => { const b = Dom.h('button', null, t); b.onclick = fn; return b; };
    line('Claude Code', su.claudeExe || 'not found', !!su.claudeExe, su.claudeExe ? btn('Change', () => changePath('file', 'claudeExe', null, 'Claude Code path set')) : btn('How to install', () => desk.openUrl('https://github.com/anthropics/claude-code')));
    line('Shell', su.pwsh || 'no PowerShell found', !!su.pwsh, btn('Change', () => changePath('file', 'pwsh', null, 'Shell path set')));
    line('Projects', su.projectsRoot || 'not set yet', !!su.projectsRoot, btn(su.projectsRoot ? 'Change' : 'Pick a folder', () => changePath('folder', 'projectsRoot', su.projectsRoot, 'Projects folder set')));
    body.appendChild(dl);
    if (!su.claudeExe) body.appendChild(Dom.h('p', 'hint', 'Install Claude Code, then press Change and point Desk at claude.exe, or restart Desk.'));
  }
  function stepAccounts(body) {
    body.appendChild(Dom.h('p', 'lede', 'Each account is its own Claude Code sign-in with its own folder. Name them, give each a colour, and sign in. Desk never reads or stores a token: the sign-in runs in Claude Code itself.'));
    const box = Dom.h('div', 'acc-list'); body.appendChild(box);
    AccountsUI.render(box);
    const b = Dom.h('button', null, 'Add account'); b.onclick = () => AccountsUI.add();
    const btns = Dom.h('div', 'btns'); btns.appendChild(b); body.appendChild(btns);
    body.appendChild(Dom.h('p', 'hint', 'A new account shares the main account\'s skills, agents, commands, plugins and CLAUDE.md. Sign in opens a pane in your first project.'));
  }
  function stepLook(body) {
    body.appendChild(Dom.h('p', 'lede', 'Pick how Desk looks. All of this is in Settings later.'));
    const grid = Dom.h('div', 'wl-look');
    const f = (label, ctl) => { const r = Dom.h('div', 'wl-row'); r.append(Dom.h('span', 'k', label), ctl); grid.appendChild(r); };
    const seg = (cls, items, attr) => { const s = Dom.h('div', 'seg ' + cls); for (const [v, t] of items) { const b = Dom.h('button', null, t); b.dataset[attr] = v; s.appendChild(b); } return s; };
    f('Theme', seg('theme', [['', 'System'], ['light', 'Light'], ['dark', 'Dark']], 'theme'));
    const sw = Dom.h('div', 'swatches'); f('Accent', sw);
    f('Text size', seg('tsize', [12, 13, 14, 16, 18].map(n => [n, String(n)]), 'font'));
    const sel = Dom.h('select', 'tfam'); sel.setAttribute('aria-label', 'Terminal font'); f('Terminal font', sel);
    body.appendChild(grid);
    const pv = Dom.h('pre', 'wl-preview'); pv.id = 'wl-preview';
    pv.append(Dom.h('span', 'c', '> '), document.createTextNode('fix the failing test in parser.js\n'), Dom.h('span', 'g', '  Read  src/parser.js\n'), Dom.h('span', 'a', '  Edit  '), document.createTextNode('src/parser.js  +3 -1'));
    body.appendChild(pv);
    renderLook();
  }
  function stepContext(body) {
    const su = snap.setup;
    body.appendChild(Dom.h('p', 'lede', 'What Desk adds to each session\'s system prompt. Every token here is sent with every message, so the default is nothing.'));
    const s = Dom.h('div', 'seg context'); s.setAttribute('role', 'group'); s.setAttribute('aria-label', 'Session context');
    for (const k of ['off', 'name', 'team']) { const b = Dom.h('button', null, CONTEXT_COPY[k][0]); b.dataset.context = k; s.appendChild(b); }
    body.appendChild(s);
    body.appendChild(Dom.h('p', 'context-note'));
    const chk = (cls, text) => { const l = Dom.h('label', 'check'); const i = Dom.h('input'); i.type = 'checkbox'; i.className = cls; l.append(i, document.createTextNode(' ' + text)); body.appendChild(l); };
    chk('usage', 'Show each account\'s usage limits. Desk gives its sessions a status line that records them; it costs no tokens.');
    chk('carry', 'After a crash or restart, tell a resumed session to carry on (one short line).');
    if (su.alliance) body.appendChild(Dom.h('p', 'hint', 'An alliance root is set, so its prompt script is used.'));
    renderContext();
  }
  let lastSig = '';
  function render(force) {
    if (!open) return;
    const body = document.getElementById('wl-body');
    const su = snap.setup;
    const sig = JSON.stringify([step, su.claudeExe, su.pwsh, su.projectsRoot, step === 1 ? snap.accountList : 0]);
    if (!force && sig === lastSig) return;
    if (!force && body.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return;
    lastSig = sig;
    const steps = document.getElementById('wl-steps');
    steps.textContent = '';
    STEPS.forEach((t, i) => { const b = Dom.h('button', 'wl-step' + (i === step ? ' on' : i < step ? ' done' : ''), `${i + 1}  ${t}`); b.onclick = () => go(i); if (i === step) b.setAttribute('aria-current', 'step'); steps.appendChild(b); });
    Dom.text(document.getElementById('wl-title'), ['Welcome to Claude Desk', 'Accounts', 'Look', 'Context'][step]);
    body.textContent = '';
    [stepCheck, stepAccounts, stepLook, stepContext][step](body);
    document.getElementById('wl-back').hidden = step === 0;
    Dom.text(document.getElementById('wl-next'), step === STEPS.length - 1 ? 'Start using Desk' : 'Next');
  }
  function go(i) { step = Math.max(0, Math.min(STEPS.length - 1, i)); render(true); }
  async function finish() {
    try { snap.accountList = await desk.setupDone(); } catch (e) { toast(e.message, 'error'); return; }
    snap.setup.firstRun = false; away = false; begun = false;
    show(false);
    renderAll();
    if (!snap.sessions.length && snap.setup.claudeExe) toast('Pick a project in the sidebar and press + to start a session');
  }
  document.getElementById('wl-next').onclick = () => step === STEPS.length - 1 ? finish() : go(step + 1);
  document.getElementById('wl-back').onclick = () => go(step - 1);
  document.getElementById('wl-skip').onclick = finish;
  el().addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); } });
  return {
    check, render: () => render(false),
    // stepping out to sign in; the home card brings it back
    away() { if (open) { away = true; show(false); } },
    resume() { away = false; step = Math.min(step, 1); check(); },
    isAway: () => away,
  };
})();
