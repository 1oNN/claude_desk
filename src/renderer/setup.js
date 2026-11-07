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
  if (typeof Welcome !== 'undefined') Welcome.preview();
  renderSetup();
}

// ---------- context ----------
// token counts are the README's: characters over four, measured from the arguments Desk builds
const CONTEXT_ROWS = {
  off: ['Nothing', 'Desk adds nothing to the system prompt.', '0 tokens'],
  name: ['Name', 'One line: "You are <session> in Claude Desk, working in <project>."', '12 tokens'],
  team: ['Name and team', 'The name line plus the other Desk sessions in the project, so they can refer to each other.', '26 tokens with 2 peers'],
};
const CONTEXT_COPY = Object.fromEntries(Object.entries(CONTEXT_ROWS).map(([k, [t, d, c]]) => [k, [t, `${d} ${c[0].toUpperCase() + c.slice(1)}.`]]));
async function setSetting(patch, msg) {
  try { snap = Object.assign(snap || {}, { setup: (await desk.setSettings(patch)).setup }); } catch (e) { toast(e.message, 'error'); return; }
  renderContext(); renderSetup(); Welcome.render();
  if (msg) toast(msg);
}
function renderContext() {
  const su = snap && snap.setup; if (!su) return;
  for (const seg of document.querySelectorAll('.seg.context')) for (const b of seg.children) b.classList.toggle('on', b.dataset.context === su.context);
  for (const b of document.querySelectorAll('.wl-opt[data-context]')) { const on = b.dataset.context === (su.context || 'off'); b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }
  for (const p of document.querySelectorAll('.context-note')) Dom.text(p, su.alliance ? 'The alliance prompt script sets the prompt, so this does not apply.' : CONTEXT_COPY[su.context || 'off'][1]);
  for (const c of document.querySelectorAll('input.carry')) c.checked = !!su.carryOn;
  for (const c of document.querySelectorAll('input.usage')) c.checked = su.usage !== 'off';
  for (const c of document.querySelectorAll('input.updates')) c.checked = su.updates !== 'off';
}
document.addEventListener('click', e => {
  const b = e.target.closest('.seg.context button, .wl-opt[data-context]'); if (b) { setSetting({ context: b.dataset.context }, 'Applies to sessions started from now on'); return; }
  const t = e.target.closest('.seg.theme button'); if (t) { setTheme(t.dataset.theme); renderLook(); return; }
  const f = e.target.closest('.seg.tsize button'); if (f) { setTermFont(Number(f.dataset.font)); renderLook(); }
});
document.addEventListener('change', e => {
  if (e.target.matches('input.carry')) setSetting({ carryOn: e.target.checked });
  else if (e.target.matches('input.usage')) setSetting({ usage: e.target.checked ? 'on' : 'off' }, 'Applies to sessions started from now on');
  else if (e.target.matches('select.tfam')) setTermFamily(e.target.value);
  else if (e.target.matches('input.updates')) setSetting({ updates: e.target.checked ? 'on' : 'off' }, 'Applies at the next start');
});

// ---------- the first-run setup ----------
// a full-window page: the rail lists the steps and, once seen, what each one was set to
const Welcome = (() => {
  const STEPS = [
    ['Check', 'What Desk needs on this PC', 'Welcome to Claude Desk'],
    ['Accounts', 'Which Claude sign-ins to use', 'Accounts'],
    ['Look', 'Theme, accent and terminal font', 'How Desk looks'],
    ['Context', 'What sessions are told about Desk', 'What sessions are told'],
  ];
  let step = 0, seen = 0, away = false, open = false, begun = false;
  let pv = null;
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
    else dropPreview();
  }
  // the answer each step gave, for the rail; null while the step is not seen yet
  function answer(i) {
    const su = snap.setup, al = snap.accountList || [];
    if (i === 0) {
      if (!su.claudeExe) return ['Claude Code not found', true];
      if (!su.projectsRoot) return ['No projects folder yet', true];
      return ['Claude Code found', false];
    }
    if (i === 1) { const n = al.filter(a => a.signedIn).length; return [`${al.length} account${al.length === 1 ? '' : 's'}, ${n} signed in`, al.length > 0 && !n]; }
    if (i === 2) return [`${{ light: 'Light', dark: 'Dark' }[ui.theme] || 'System'}, ${ui.termFamily || 'Cascadia Mono'} ${ui.termFont || 14}`, false];
    return [`${CONTEXT_ROWS[su.context || 'off'][0]}, ${CONTEXT_ROWS[su.context || 'off'][2]}`, false];
  }
  function rail() {
    const box = document.getElementById('wl-steps');
    box.textContent = '';
    STEPS.forEach(([name, q], i) => {
      const done = i !== step && i <= seen;
      const b = Dom.h('button', 'wl-step' + (i === step ? ' on' : done ? ' done' : ''));
      const n = Dom.h('span', 'wl-n'); if (done) n.appendChild(svgUse('i-check')); else n.textContent = String(i + 1);
      const [a, bad] = i <= seen ? answer(i) : [q, false];
      const t = Dom.h('span', 'wl-t'); t.append(Dom.h('b', null, name), Dom.h('span', 'wl-d' + (i <= seen ? ' ans' : '') + (bad ? ' warn' : ''), a));
      b.append(n, t);
      b.onclick = () => go(i);
      if (i === step) b.setAttribute('aria-current', 'step');
      const li = Dom.h('li'); li.appendChild(b); box.appendChild(li);
    });
  }
  const btn = (t, fn, cls) => { const b = Dom.h('button', cls || null, t); b.onclick = fn; return b; };
  function stepCheck(body) {
    const su = snap.setup;
    body.appendChild(Dom.h('p', 'lede', 'Desk runs Claude Code sessions and shells side by side, across your Claude accounts. It needs Claude Code, a shell, and the folder that holds your projects.'));
    const dl = Dom.h('div', 'wl-checks');
    const line = (k, v, ok, b) => {
      const r = Dom.h('div', 'wl-chk ' + (ok ? 'ok' : 'bad'));
      r.append(svgUse(ok ? 'i-check' : 'i-attention'), Dom.h('span', 'k', k), Dom.h('span', 'v', v), b);
      dl.appendChild(r);
    };
    line('Claude Code', su.claudeExe || 'Not found on this PC', !!su.claudeExe, su.claudeExe ? btn('Change', () => changePath('file', 'claudeExe', null, 'Claude Code path set')) : btn('How to install', () => desk.openUrl('https://github.com/anthropics/claude-code')));
    line('Shell', su.pwsh || 'No PowerShell found', !!su.pwsh, btn('Change', () => changePath('file', 'pwsh', null, 'Shell path set')));
    line('Projects', su.projectsRoot || 'Not set yet', !!su.projectsRoot, btn(su.projectsRoot ? 'Change' : 'Pick a folder', () => changePath('folder', 'projectsRoot', su.projectsRoot, 'Projects folder set'), su.projectsRoot ? null : 'primary'));
    body.appendChild(dl);
    if (!su.claudeExe) body.appendChild(Dom.h('p', 'hint', 'Install Claude Code, then press Change and point Desk at claude.exe, or restart Desk.'));
    else if (!su.projectsRoot) body.appendChild(Dom.h('p', 'hint', 'Each folder inside the projects folder shows up as a project. You can also open any folder later.'));
  }
  function stepAccounts(body) {
    body.appendChild(Dom.h('p', 'lede', 'Each account is its own Claude Code sign-in with its own folder. Name them, give each a colour, and sign in. Desk never reads or stores a token: the sign-in runs in Claude Code itself.'));
    // how each account's sessions will look in the tab strip
    const strip = Dom.h('div', 'wl-strip'); strip.setAttribute('aria-hidden', 'true');
    for (const a of snap.accountList || []) {
      const t = Dom.h('div', 'tab placed');
      const d = Dom.h('span', 'dot'); d.style.background = a.colour;
      t.append(d, Dom.h('span', 'tname', a.name));
      strip.appendChild(t);
    }
    if (strip.children.length) body.appendChild(strip);
    const box = Dom.h('div', 'acc-list'); body.appendChild(box);
    AccountsUI.render(box);
    const btns = Dom.h('div', 'btns'); btns.appendChild(btn('Add account', () => AccountsUI.add())); body.appendChild(btns);
    body.appendChild(Dom.h('p', 'hint', 'A new account shares the main account\'s skills, agents, commands, plugins and CLAUDE.md. Sign in opens a pane in your first project.'));
  }
  function stepLook(body) {
    body.appendChild(Dom.h('p', 'lede', 'Pick how Desk looks. The terminal below is a real one, drawn the way your sessions will be. All of this is in Settings later.'));
    const grid = Dom.h('div', 'wl-look');
    const f = (label, ctl) => grid.append(Dom.h('span', 'k', label), ctl);
    const seg = (cls, items, attr) => { const s = Dom.h('div', 'seg ' + cls); for (const [v, t] of items) { const b = Dom.h('button', null, t); b.dataset[attr] = v; s.appendChild(b); } return s; };
    f('Theme', seg('theme', [['', 'System'], ['light', 'Light'], ['dark', 'Dark']], 'theme'));
    f('Accent', Dom.h('div', 'swatches'));
    f('Text size', seg('tsize', [12, 13, 14, 16, 18].map(n => [n, String(n)]), 'font'));
    const sel = Dom.h('select', 'tfam'); sel.setAttribute('aria-label', 'Terminal font'); f('Terminal font', sel);
    body.appendChild(grid);
    const box = Dom.h('div', 'wl-term'); box.setAttribute('aria-label', 'Terminal preview'); body.appendChild(box);
    pv = { box, term: null, fit: null };
    renderLook();
  }
  // a scripted Claude Code exchange; the prompt marks use the accent like the cursor does
  function script() {
    const m = /^#([0-9a-f]{6})$/i.exec(getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());
    const n = m ? parseInt(m[1], 16) : 0xC4182F;
    const A = `\x1b[38;2;${n >> 16};${n >> 8 & 255};${n & 255}m`, Z = '\x1b[0m', D = '\x1b[2m', B = '\x1b[1m', G = '\x1b[32m', Rd = '\x1b[31m';
    return [
      `${A}>${Z} fix the failing test in parser.js`, '',
      `${A}\u25cf${Z} ${B}Read${Z}(src/parser.js)`, `  ${D}\u23bf  Read 182 lines${Z}`, '',
      `${A}\u25cf${Z} ${B}Update${Z}(src/parser.js)`, `  ${D}\u23bf  Updated src/parser.js with 3 additions and 1 removal${Z}`,
      `       ${Rd}41 -    if (tok === ',') break;${Z}`, `       ${G}41 +    if (tok === ',') {${Z}`, `       ${G}42 +      skipSpace();${Z}`, `       ${G}43 +      continue;${Z}`, '',
      `${A}\u25cf${Z} The test passes now: a comma inside a list was ending the parse early.`, '',
      `${A}>${Z} `,
    ];
  }
  const ROWS = 15;
  function preview() {
    if (!pv || !open || !pv.box.isConnected) return;
    const size = ui.termFont || 14;
    const opts = { theme: Object.assign({}, termTheme || {}), fontSize: size, fontFamily: (ui.termFamily ? `"${ui.termFamily}", ` : '') + '"Cascadia Mono", Consolas, "Courier New", monospace' };
    if (!pv.term) {
      pv.term = new Terminal(Object.assign(opts, { lineHeight: 1.2, minimumContrastRatio: 4.5, cursorStyle: 'block', cursorBlink: false, disableStdin: true, scrollback: 0 }));
      pv.fit = new FitAddon.FitAddon(); pv.term.loadAddon(pv.fit);
      pv.term.open(pv.box);
    } else Object.assign(pv.term.options, opts);
    // fit only sets the width; the height follows the script's rows
    const d = pv.fit.proposeDimensions();
    if (d && d.cols) pv.term.resize(d.cols, ROWS);
    pv.term.reset();
    // no auto-wrap: a narrow window clips the long lines instead of pushing the prompt off the top
    pv.term.write('\x1b[?7l' + script().join('\r\n'));
  }
  function dropPreview() { if (pv && pv.term) pv.term.dispose(); pv = null; }
  function stepContext(body) {
    const su = snap.setup;
    body.appendChild(Dom.h('p', 'lede', 'What Desk adds to each session\'s system prompt. Every token here is sent with every message, so the default is nothing.'));
    const opts = Dom.h('div', 'wl-opts'); opts.setAttribute('role', 'group'); opts.setAttribute('aria-label', 'Session context');
    for (const [k, [t, d, c]] of Object.entries(CONTEXT_ROWS)) {
      const b = Dom.h('button', 'wl-opt'); b.dataset.context = k;
      const tx = Dom.h('span', 'tx'); tx.append(Dom.h('b', null, t), Dom.h('span', 'd', d));
      b.append(Dom.h('span', 'rd'), tx, Dom.h('span', 'cost', c));
      opts.appendChild(b);
    }
    body.appendChild(opts);
    if (su.alliance) body.appendChild(Dom.h('p', 'hint', 'An alliance root is set, so its prompt script is used and this choice does not apply.'));
    const chk = (cls, text) => { const l = Dom.h('label', 'check'); const i = Dom.h('input'); i.type = 'checkbox'; i.className = cls; l.append(i, document.createTextNode(' ' + text)); body.appendChild(l); };
    chk('usage', 'Show each account\'s usage limits. Desk gives its sessions a status line that records them; it costs no tokens.');
    chk('carry', 'After a crash or restart, tell a resumed session to carry on (one short line, about 24 tokens).');
    renderContext();
  }
  let lastSig = '';
  function render(force) {
    if (!open) return;
    const body = document.getElementById('wl-body');
    const su = snap.setup;
    const sig = JSON.stringify([step, seen, su.claudeExe, su.pwsh, su.projectsRoot, su.context, ui.theme, ui.termFont, ui.termFamily, snap.accountList]);
    if (!force && sig === lastSig) return;
    rail();
    if (!force && (step === 2 || body.contains(document.activeElement) && document.activeElement.tagName === 'INPUT')) { lastSig = sig; return; }
    lastSig = sig;
    Dom.text(document.getElementById('wl-app'), su.appName || 'Claude Desk');
    Dom.text(document.getElementById('wl-title'), STEPS[step][2]);
    dropPreview();
    body.textContent = '';
    [stepCheck, stepAccounts, stepLook, stepContext][step](body);
    document.getElementById('wl-back').hidden = step === 0;
    Dom.text(document.getElementById('wl-next'), step === STEPS.length - 1 ? 'Start using Desk' : 'Next');
    document.querySelector('#welcome .wl-scroll').scrollTop = 0;
  }
  function go(i) { step = Math.max(0, Math.min(STEPS.length - 1, i)); seen = Math.max(seen, step); render(true); }
  const next = () => step === STEPS.length - 1 ? finish() : go(step + 1);
  async function finish() {
    try { snap.accountList = await desk.setupDone(); } catch (e) { toast(e.message, 'error'); return; }
    snap.setup.firstRun = false; away = false; begun = false;
    show(false);
    renderAll();
    if (!snap.sessions.length && snap.setup.claudeExe) toast('Pick a project in the sidebar and press + to start a session');
  }
  document.getElementById('wl-next').onclick = next;
  document.getElementById('wl-back').onclick = () => go(step - 1);
  document.getElementById('wl-skip').onclick = finish;
  // Enter moves on unless a control has focus; Esc skips, or just leaves a text box first
  window.addEventListener('keydown', e => {
    if (!open || e.isComposing) return;
    const t = e.target, typing = t && t.matches && t.matches('input:not([type=checkbox]):not([type=color]), select, textarea');
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (typing) t.blur(); else finish(); }
    else if (e.key === 'Enter' && !e.ctrlKey && !e.altKey && !(t && t.closest && t.closest('button, a, input, select, textarea'))) { e.preventDefault(); e.stopPropagation(); next(); }
  }, true);
  return {
    check, render: () => render(false), preview: () => { preview(); if (open) rail(); },
    // stepping out to sign in; the home page brings it back
    away() { if (open) { away = true; show(false); } },
    resume() { away = false; step = Math.min(step, 1); check(); },
    isAway: () => away,
  };
})();
