// The Settings page: one schema, rendered once into #settings-page, refreshed in place. Handlers are delegated on the
// page, so a refresh never drops a binding. Uses app.js and setup.js globals at call time.

// the keys list, shared by this page and the Ctrl+/ card
const KEYS_LIST = [
  ['Ctrl+K', 'command palette: say, new session, panes, views, theme'],
  ['Ctrl+P', 'jump to a session or project'],
  ['Ctrl+Shift+N', 'new Claude session in this project'],
  ['Ctrl+Shift+T', 'new shell in this project'],
  ['Ctrl+Shift+M', 'move this pane to a new window'],
  ['Ctrl+1 to 8', 'focus that pane'],
  ['Ctrl+Shift+1 to 8', 'one to eight panes'],
  ['Ctrl+Tab', 'next session in the pane'],
  ['Ctrl+Shift+Tab', 'previous session in the pane'],
  ['Ctrl+B', 'hide or show the sidebar'],
  ['Ctrl+Shift+B', 'hide or show the whole left panel, icons too'],
  ['Ctrl+,', 'settings'],
  ['Ctrl+wheel', 'zoom what is under the pointer: one terminal, the sidebar, the top bars, the status bar or home. The rest stays as it is'],
  ['Ctrl+= and Ctrl+-', 'zoom what has focus, the terminal you are typing in; Ctrl+0 puts it back'],
  ['Ctrl+Shift+= and Ctrl+Shift+-', 'zoom the whole window; Ctrl+Shift+0 back to 100%'],
  ['Ctrl+C', 'in a terminal, copies when text is selected, otherwise stops the program as usual'],
  ['Ctrl+V or right click', 'paste into the terminal; right click copies instead when text is selected'],
  ['Ctrl+click', 'open a web link printed in a terminal'],
  ['Ctrl+/ or F1', 'this list as a card'],
  ['Alt', 'the menus, when no terminal has focus'],
  ['F11', 'full screen'],
  ['Esc', 'close a menu, the palette or the keys card, or clear the toasts'],
  ['In the sidebar', 'Up and Down move, Enter opens, Right reaches a row\'s buttons or expands, Left collapses, Delete stops'],
];
function keysList() {
  const dl = Dom.h('dl', 'keys');
  for (const [k, v] of KEYS_LIST) dl.append(Dom.h('dt', null, k), Dom.h('dd', null, v));
  return dl;
}

const Settings = (() => {
  const su = () => (snap && snap.setup) || {};
  const CATS = ['Accounts', 'Appearance', 'Terminal', 'Sessions', 'Context', 'Attention', 'Updates', 'Paths', 'Keyboard'];
  const startNote = () => {
    const st = su().start;
    return st ? `This start: ${st.started} of ${st.saved} saved PC session${st.saved === 1 ? '' : 's'} started, ${st.waiting} waiting with Resume. A change applies at the next start.` : 'A change applies at the next start.';
  };
  const pathRow = (id, key, title, what, missing, env, envName, msg) => ({
    id, cat: 'Paths', title, type: 'path', keys: 'folder file exe location ' + envName,
    desc: () => su().env && su().env[env] ? `Set by ${envName}, so it cannot be changed here.` : null,
    value: () => su()[key] || '', missing, locked: () => !!(su().env && su().env[env]),
    change: () => changePath(what, key, key === 'projectsRoot' ? su().projectsRoot : null, msg),
  });
  // type: seg | bool | select | path | custom | action. def marks a setting as changed when get() differs from it.
  const S = [
    { id: 'accounts', cat: 'Accounts', title: 'Accounts', type: 'custom', keys: 'sign in login claude config colour role email remove',
      desc: 'Each account is a Claude Code sign-in with its own folder. Sign in runs Claude Code\'s own login in a pane; Desk never reads or stores a token.',
      build: box => { const l = Dom.h('div', 'acc-list'); l.id = 'acc-list'; box.appendChild(l);
        const b = Dom.h('div', 'btns'); const a = Dom.h('button', null, 'Add account'); a.dataset.do = 'acc-add';
        const r = Dom.h('button', null, 'Run setup again'); r.dataset.do = 'acc-setup'; b.append(a, r); box.appendChild(b); },
      refresh: box => AccountsUI.render(box.querySelector('.acc-list')) },

    { id: 'theme', cat: 'Appearance', title: 'Theme', type: 'seg', keys: 'dark light colour mode',
      opts: [['', 'System'], ['light', 'Light'], ['dark', 'Dark']], get: () => ui.theme || '', def: '', set: v => { setTheme(v); renderLook(); } },
    { id: 'accent', cat: 'Appearance', title: 'Accent', type: 'custom', keys: 'colour color cursor highlight',
      desc: 'For the focused pane, buttons and the cursor.', get: () => ui.accent || '', def: '', set: v => setAccent(v),
      build: box => box.appendChild(Dom.h('div', 'swatches')), refresh: box => renderSwatches(box.querySelector('.swatches')) },
    { id: 'scale', cat: 'Appearance', title: 'Window zoom', type: 'seg', keys: 'size scale text bigger smaller ui',
      desc: 'Everything at once. Ctrl+Shift+= and Ctrl+Shift+-, or the buttons at the bottom right.',
      opts: [[0.9, 'Small'], [1, 'Normal'], [1.2, 'Large'], [1.4, 'Larger']], get: () => ui.uiScale || 1, def: 1, set: v => setScale(Number(v)) },
    { id: 'statusbar', cat: 'Appearance', title: 'Status bar', type: 'bool', keys: 'bottom bar hide',
      label: 'Show the status bar at the bottom of the window', get: () => !ui.statusHidden, def: true,
      set: v => { ui.statusHidden = !v; saveUi(); renderShell(); } },
    { id: 'sidebar', cat: 'Appearance', title: 'Sidebar width', type: 'action', keys: 'sidebar width resize left panel',
      desc: 'Drag its right edge to resize. Ctrl+B hides and shows it, Ctrl+Shift+B hides the icons too.',
      actions: [['sb-reset', 'Reset width']], get: () => ui.sidebar.w, def: () => SIDEBAR_DEF, set: () => resetSidebarWidth() },

    { id: 'termFont', cat: 'Terminal', title: 'Text size', type: 'seg', keys: 'font size zoom pixels',
      desc: 'For every terminal you have not sized on its own. Ctrl+wheel over one terminal sizes that terminal only.',
      opts: [[12, '12'], [13, '13'], [14, '14'], [16, '16'], [18, '18']], get: () => ui.termFont || 14, def: 14, set: v => { setTermFont(Number(v)); renderLook(); } },
    { id: 'termFamily', cat: 'Terminal', title: 'Font', type: 'select', keys: 'font family typeface monospace cascadia consolas',
      desc: 'A font that is not installed falls back to Cascadia Mono.', opts: () => TERM_FONTS.map(f => [f === 'Cascadia Mono' ? '' : f, f]),
      get: () => ui.termFamily || '', def: '', set: v => setTermFamily(v) },
    { id: 'zoomAll', cat: 'Terminal', title: 'Every zoom', type: 'action', keys: 'reset zoom size pane region',
      desc: 'Every part zooms on its own: each terminal, the sidebar, the top bars, the status bar and home. This puts them all back.',
      actions: [['zoom-all', 'Reset every zoom']] },

    { id: 'resume', cat: 'Sessions', title: 'Start with Desk', type: 'seg', keys: 'resume restart startup saved ram memory',
      desc: 'Which saved sessions start with Desk. A Claude session takes 400 MB or more of RAM, a shell about 100 MB. The rest wait in their pane with a Resume button.',
      note: startNote, opts: [['current', 'Open panes only'], ['all', 'All'], ['none', 'None']], get: () => su().resume || 'current', def: 'current',
      set: v => setSetting({ resume: v }, v === 'all' ? 'Every saved session starts with Desk from the next start' : v === 'none' ? 'No saved session starts with Desk from the next start' : 'Only the open panes start with Desk from the next start') },
    { id: 'carryOn', cat: 'Sessions', title: 'Carry on after a restart', type: 'bool', keys: 'resume crash continue',
      label: 'Tell a resumed session to carry on after a crash or restart', get: () => !!su().carryOn, def: false, set: v => setSetting({ carryOn: v }) },
    { id: 'showMem', cat: 'Sessions', title: 'Memory per session', type: 'bool', keys: 'ram memory mb sidebar',
      label: 'Show how much memory each session uses, in the sidebar', get: () => !!ui.showMem, def: false,
      set: v => { ui.showMem = v; saveUi(); renderMemToggle(); renderSidebar(); } },
    { id: 'oneLiner', cat: 'Sessions', title: 'Live one-liner', type: 'bool', keys: 'haiku summary line sidebar alliance', when: () => su().alliance,
      label: 'Ask Haiku every 30 s what each working Claude session is doing (on that session\'s own subscription)',
      note: () => 'Applies at the next start.', get: () => su().oneLiner !== 'off', def: true, set: v => setSetting({ oneLiner: v ? 'on' : 'off' }, 'Applies at the next start') },
    { id: 'gpu', cat: 'Sessions', title: 'Graphics', type: 'seg', keys: 'gpu software ram memory painting',
      desc: 'Software painting drops the GPU process, about 100 MB, and uses the CPU instead. The window looks the same. Applies at the next start.',
      opts: [['on', 'GPU'], ['off', 'Software']], get: () => su().gpu || 'on', def: 'on',
      set: v => setSetting({ gpu: v }, v === 'off' ? 'Software painting from the next start' : 'GPU painting from the next start') },

    { id: 'context', cat: 'Context', title: 'Session context', type: 'seg', keys: 'system prompt tokens name team',
      desc: 'What Desk adds to each session\'s system prompt. It is sent with every message.',
      note: () => su().alliance ? 'The alliance prompt script sets the prompt, so this does not apply.' : CONTEXT_COPY[su().context || 'off'][1],
      opts: [['off', 'Nothing'], ['name', 'Name'], ['team', 'Name and team']], get: () => su().context || 'off', def: 'off',
      set: v => setSetting({ context: v }, 'Applies to sessions started from now on') },
    { id: 'usage', cat: 'Context', title: 'Usage limits', type: 'bool', keys: 'status line limit 5 hour weekly tokens',
      label: 'Show usage limits (a status line Desk gives its sessions, no tokens)', get: () => su().usage !== 'off', def: true,
      set: v => setSetting({ usage: v ? 'on' : 'off' }, 'Applies to sessions started from now on') },

    { id: 'flash', cat: 'Attention', title: 'Taskbar flash', type: 'bool', keys: 'notify waiting needs you taskbar',
      desc: 'A session that needs you shows on the bell, in the window title and at the top of Desk home with how long it has waited.',
      label: 'Flash the taskbar button when Desk is in the background', get: () => ui.flash !== false, def: true, set: v => { ui.flash = v; saveUi(); } },
    { id: 'notify', cat: 'Attention', title: 'Desktop notifications', type: 'bool', keys: 'toast windows notification',
      label: 'Send a desktop notification as well', get: () => !!ui.notify, def: false, actions: [['notify-test', 'Send a test notification']],
      note: () => !ui.notify ? 'Off. The badge, the window title and the taskbar flash still work.'
        : notifyAllowed() ? 'Sent only while Desk is in the background. Clicking one opens Needs you.'
        : 'Windows has not allowed notifications for Desk, so none will be sent.',
      set: async v => { ui.notify = v; if (v && !notifyAllowed() && typeof Notification !== 'undefined') await Notification.requestPermission(); saveUi(); } },

    { id: 'updates', cat: 'Updates', title: 'Automatic updates', type: 'bool', keys: 'version github release install',
      desc: () => `Claude Desk ${su().version || ''}`, label: 'Check GitHub for a new version and install it when Desk closes',
      get: () => su().updates !== 'off', def: true, actions: [['upd-check', 'Check now']],
      set: v => setSetting({ updates: v ? 'on' : 'off' }, 'Applies at the next start') },

    pathRow('projectsRoot', 'projectsRoot', 'Projects folder', 'folder', 'not set', 'projects', 'DESK_PROJECTS', 'Projects folder set'),
    pathRow('claudeExe', 'claudeExe', 'Claude Code', 'file', 'not found', 'claude', 'DESK_CLAUDE', 'Claude Code path set. New sessions use it'),
    pathRow('pwsh', 'pwsh', 'Shell', 'file', 'not found', 'pwsh', 'DESK_PWSH', 'Shell path set. New shells use it'),
    { id: 'state', cat: 'Paths', title: 'State folder', type: 'action', keys: 'log settings json layout',
      desc: () => su().stateDir ? `Settings, layout and the log live in ${su().stateDir}.` : 'Settings, layout and the log.',
      actions: [['open-state', 'Open state folder'], ['open-log', 'Open log']] },

    { id: 'keys', cat: 'Keyboard', title: 'Keys', type: 'custom', keys: () => KEYS_LIST.flat().join(' '),
      desc: 'Everything else reaches the terminal. F12 opens the developer tools.',
      build: box => { box.appendChild(keysList()); const b = Dom.h('div', 'btns'); const k = Dom.h('button', null, 'Show as a card'); k.dataset.do = 'keys-show'; b.appendChild(k); box.appendChild(b); } },
  ];
  const DO = {
    'acc-add': () => AccountsUI.add(),
    'acc-setup': () => { snap.setup.firstRun = true; Welcome.resume(); },
    'sb-reset': () => resetSidebarWidth(),
    'zoom-all': () => resetAllZoom(),
    'notify-test': () => {
      if (!notifyAllowed()) { toast('Windows has not allowed notifications for Desk', 'error'); return; }
      new Notification(su().appName || 'Claude Desk', { body: 'This is what a session needing you looks like.' });
    },
    'upd-check': async () => { try { const r = await desk.checkUpdate(); toast(r.note || 'Desk is up to date'); } catch (e) { toast(e.message, 'error'); } },
    'open-state': () => desk.openPath('state'),
    'open-log': () => desk.openPath('log'),
    'keys-show': () => keysPop.open(true),
    close: () => setNav('projects'),
  };
  const val = f => typeof f === 'function' ? f() : f;
  const byId = Object.fromEntries(S.map(s => [s.id, s]));
  let page = null, rows = new Map(), query = '';

  function build() {
    page = document.getElementById('settings-page');
    page.textContent = '';
    const head = Dom.h('header', 'set-head');
    const h1 = Dom.h('h1', null, 'Settings');
    const sw = Dom.h('div', 'set-search');
    const q = Dom.h('input'); q.type = 'search'; q.id = 'set-q'; q.placeholder = 'Search settings'; q.setAttribute('aria-label', 'Search settings'); q.spellcheck = false;
    const cnt = Dom.h('span', 'set-count'); cnt.setAttribute('aria-live', 'polite');
    sw.append(q, cnt);
    const jump = Dom.h('select', 'set-jump'); jump.setAttribute('aria-label', 'Go to a section');
    const x = Dom.h('button', 'ib set-close'); x.title = 'Close Settings (Ctrl+,)'; x.setAttribute('aria-label', 'Close Settings'); x.dataset.do = 'close';
    x.appendChild(svgUse('i-x'));
    head.append(h1, sw, jump, x);
    const body = Dom.h('div', 'set-body');
    const toc = Dom.h('nav', 'set-toc'); toc.setAttribute('aria-label', 'Settings sections');
    const list = Dom.h('div', 'set-list');
    for (const c of CATS) {
      const t = Dom.h('button', 'toc', c); t.dataset.cat = c; toc.appendChild(t);
      const o = Dom.h('option', null, c); o.value = c; jump.appendChild(o);
      const sec = Dom.h('section', 'set-sec'); sec.dataset.cat = c;
      sec.appendChild(Dom.h('h2', null, c));
      for (const s of S.filter(x => x.cat === c)) sec.appendChild(row(s));
      list.appendChild(sec);
    }
    const none = Dom.h('p', 'set-none', 'No settings match.'); none.hidden = true; list.appendChild(none);
    body.append(toc, list);
    page.append(head, body);
    q.addEventListener('input', () => { query = q.value.trim().toLowerCase(); filter(); });
    q.addEventListener('keydown', e => { if (e.key === 'Escape' && q.value) { e.stopPropagation(); q.value = ''; query = ''; filter(); } });
    toc.addEventListener('click', e => { const b = e.target.closest('.toc'); if (b) goTo(b.dataset.cat); });
    jump.addEventListener('change', () => goTo(jump.value));
    list.addEventListener('scroll', spy, { passive: true });
    page.addEventListener('click', onClick);
    page.addEventListener('change', onChange);
  }

  function row(s) {
    const r = Dom.h('div', 'set-row'); r.dataset.sid = s.id;
    const t = Dom.h('div', 'set-title'); if (s.title !== s.cat) t.appendChild(Dom.h('span', 'cat', s.cat + ': ')); t.appendChild(Dom.h('b', null, s.title));
    const rs = Dom.h('button', 'link set-reset', 'Reset'); rs.dataset.reset = s.id; rs.hidden = true; rs.title = 'Back to the default';
    t.appendChild(rs);
    r.appendChild(t);
    r.appendChild(Dom.h('p', 'set-desc'));
    const c = Dom.h('div', 'set-ctl');
    if (s.type === 'seg') {
      const g = Dom.h('div', 'seg'); g.setAttribute('role', 'group'); g.setAttribute('aria-label', s.title);
      for (const [v, l] of val(s.opts)) { const b = Dom.h('button', null, l); b.dataset.v = String(v); g.appendChild(b); }
      c.appendChild(g);
    } else if (s.type === 'bool') {
      const l = Dom.h('label', 'check'); const i = Dom.h('input'); i.type = 'checkbox'; i.dataset.bool = s.id;
      l.append(i, document.createTextNode(' ' + s.label)); c.appendChild(l);
    } else if (s.type === 'select') {
      const sel = Dom.h('select'); sel.dataset.sel = s.id; sel.setAttribute('aria-label', s.title);
      for (const [v, l] of val(s.opts)) { const o = Dom.h('option', null, l); o.value = v; sel.appendChild(o); }
      c.appendChild(sel);
    } else if (s.type === 'path') {
      const f = Dom.h('div', 'set-path'); const v = Dom.h('span', 'fv'); const b = Dom.h('button', null, 'Change'); b.dataset.change = s.id;
      b.setAttribute('aria-label', `Change the ${s.title.toLowerCase()} path`); f.append(v, b); c.appendChild(f);
    } else if (s.type === 'custom') s.build(c);
    if (s.actions) {
      const b = Dom.h('div', 'btns');
      for (const [d, l] of s.actions) { const x = Dom.h('button', null, l); x.dataset.do = d; b.appendChild(x); }
      c.appendChild(b);
    }
    r.appendChild(c);
    if (s.note) r.appendChild(Dom.h('p', 'set-note'));
    rows.set(s.id, r);
    return r;
  }

  function changed(s) { return s.def !== undefined && s.get && s.get() !== val(s.def); }

  function refresh() {
    if (!page || page.hidden || !snap) return;
    for (const s of S) {
      const r = rows.get(s.id); if (!r) continue;
      const on = !s.when || !!s.when();
      r.classList.toggle('off', !on);
      if (!on) continue;
      Dom.text(r.querySelector('.set-desc'), val(s.desc) || '');
      r.querySelector('.set-desc').hidden = !val(s.desc);
      if (s.note) Dom.text(r.querySelector('.set-note'), val(s.note) || '');
      const mod = changed(s);
      r.classList.toggle('mod', mod);
      r.querySelector('.set-reset').hidden = !mod;
      const c = r.querySelector('.set-ctl');
      if (s.type === 'seg') { const cur = String(s.get()); for (const b of c.querySelector('.seg').children) { const on2 = b.dataset.v === cur; b.classList.toggle('on', on2); b.setAttribute('aria-pressed', on2); } }
      else if (s.type === 'bool') c.querySelector('input').checked = !!s.get();
      else if (s.type === 'select') { const sel = c.querySelector('select'); if (document.activeElement !== sel) sel.value = s.get(); }
      else if (s.type === 'path') {
        const v = s.value(), fv = c.querySelector('.fv');
        Dom.text(fv, v || s.missing); fv.classList.toggle('bad', !v);
        const b = c.querySelector('[data-change]'); b.disabled = s.locked();
      } else if (s.refresh) s.refresh(c);
    }
    filter();
  }

  function hay(s) { return [s.cat, s.title, val(s.desc), s.label, val(s.keys), val(s.note)].filter(Boolean).join(' ').toLowerCase(); }
  function filter() {
    if (!page) return;
    const words = query.split(/\s+/).filter(Boolean);
    let n = 0;
    for (const sec of page.querySelectorAll('.set-sec')) {
      let any = 0;
      for (const r of sec.querySelectorAll('.set-row')) {
        const s = byId[r.dataset.sid];
        const show = !r.classList.contains('off') && words.every(w => hay(s).includes(w));
        r.hidden = !show; if (show) { any++; n++; }
      }
      sec.hidden = !any;
      const t = page.querySelector(`.toc[data-cat="${sec.dataset.cat}"]`);
      t.hidden = !any; Dom.text(t, words.length && any ? `${sec.dataset.cat} (${any})` : sec.dataset.cat);
    }
    Dom.text(page.querySelector('.set-count'), words.length ? `${n} setting${n === 1 ? '' : 's'} found` : '');
    page.querySelector('.set-none').hidden = n > 0;
    spy();
  }

  function goTo(cat) {
    const sec = page.querySelector(`.set-sec[data-cat="${cat}"]`); if (!sec || sec.hidden) return;
    const list = page.querySelector('.set-list');
    list.scrollTo({ top: sec.offsetTop - list.offsetTop, behavior: 'instant' });
    mark(cat);
  }
  function spy() {
    const list = page.querySelector('.set-list');
    let cur = null;
    for (const sec of list.querySelectorAll('.set-sec')) { if (sec.hidden) continue; if (!cur) cur = sec; if (sec.offsetTop - list.offsetTop <= list.scrollTop + 24) cur = sec; }
    if (cur) mark(cur.dataset.cat);
  }
  function mark(cat) {
    for (const t of page.querySelectorAll('.toc')) { const on = t.dataset.cat === cat; t.classList.toggle('on', on); Dom.attr(t, 'aria-current', on ? 'true' : null); }
    const j = page.querySelector('.set-jump'); if (j.value !== cat) j.value = cat;
  }

  async function onClick(e) {
    const rs = e.target.closest('[data-reset]');
    if (rs) { const s = byId[rs.dataset.reset]; await s.set(val(s.def)); refresh(); return; }
    const d = e.target.closest('[data-do]');
    if (d) { await DO[d.dataset.do](); refresh(); return; }
    const ch = e.target.closest('[data-change]');
    if (ch) { await byId[ch.dataset.change].change(); refresh(); return; }
    const b = e.target.closest('.set-row .seg button');
    if (b) { const s = byId[b.closest('.set-row').dataset.sid]; await s.set(b.dataset.v); refresh(); }
  }
  async function onChange(e) {
    const t = e.target;
    if (t.dataset.bool) { await byId[t.dataset.bool].set(t.checked); refresh(); }
    else if (t.dataset.sel) { await byId[t.dataset.sel].set(t.value); refresh(); }
  }

  function show(on) {
    if (on && !page) build();
    if (!page) return;
    const was = page.hidden;
    page.hidden = !on;
    if (on) { refresh(); if (was) focusSearch(); }
  }
  function focusSearch() { const q = document.getElementById('set-q'); if (q) { q.focus(); q.select(); } }
  return { show, refresh, focusSearch, goTo: c => { if (ui.nav !== 'settings') setNav('settings'); show(true); goTo(c); }, schema: S };
})();
