// The title bar: Desk's menus, a drag region, and the command centre. Windows draws the caption buttons (titleBarOverlay).
// Menu items point at COMMANDS (app.js) where one exists, so the palette and the menus never disagree.
(() => {
  const DOCS = 'https://1onn.github.io/claude_desk/';
  const REPO = 'https://github.com/1oNN/claude_desk';
  const cmd = id => COMMANDS.find(c => c.id === id);
  const term = () => { const id = focusedId(); const r = id && Terminals.get(id); return r && r.term ? r.term : null; };
  const otherWins = () => (snap && snap.windows || []).filter(w => w.wid !== myWid);

  const MENUS = [
    { id: 'file', label: '&File', items: () => [
      { label: 'New Claude &session', cmd: 'new' },
      { label: 'New s&hell', cmd: 'shell' },
      { label: 'New &window', cmd: 'win-new' },
      '-',
      { label: 'New &project...', cmd: 'proj-new' },
      { label: '&Open folder...', cmd: 'addpc' },
      { label: 'Add a &laptop folder...', cmd: 'addlaptop', hideOff: true },
      '-',
      { label: 'Se&ttings', cmd: 'settings' },
      '-',
      { label: '&Close window', cmd: 'win-close' },
      { label: 'E&xit', cmd: 'quit' },
    ] },
    { id: 'edit', label: '&Edit', items: () => [
      { label: '&Copy', key: 'Ctrl+C', when: () => !!(term() && term().hasSelection()), run: () => { const t = term(); Terminals.io.write(t.getSelection()); t.clearSelection(); t.focus(); } },
      { label: '&Paste', key: 'Ctrl+V', when: () => !!term(), run: async () => { const t = term(); let s = ''; try { s = await Terminals.io.read(); } catch { /* empty */ } if (s) t.paste(s); t.focus(); } },
      { label: 'Select &all', when: () => !!term(), run: () => { const t = term(); t.selectAll(); t.focus(); } },
      '-',
      { label: '&Say to Claude sessions...', cmd: 'say' },
    ] },
    { id: 'view', label: '&View', items: () => [
      { label: '&Command palette...', key: 'Ctrl+K', run: () => openPalette('commands') },
      { label: '&Go to project or session...', key: 'Ctrl+P', run: () => openPalette('jump') },
      '-',
      { label: 'Desk &home', cmd: 'home', check: () => ui.nav === 'home' },
      { label: 'P&rojects', cmd: 'projects', check: () => ui.nav === 'projects' },
      { label: '&Needs you', cmd: 'attention', check: () => ui.nav === 'attention' },
      '-',
      { label: '&Sidebar', cmd: 'sidebar', check: () => !ui.sidebar.collapsed && !ui.sidebar.hidden },
      { label: '&Left panel', cmd: 'panel', check: () => !ui.sidebar.hidden },
      { label: 'Status &bar', cmd: 'statusbar', check: () => !ui.statusHidden },
      { label: 'Pa&nes', when: inProject, sub: () => [1, 2, 3, 4, 5, 6, 7, 8].map(n => ({ label: `&${n}`, key: `Ctrl+Shift+${n}`, check: () => view(ui.current).n === n, run: () => setSplit(n) })) },
      '-',
      { label: 'Zoom &in', cmd: 'zoom-in' },
      { label: 'Zoom &out', cmd: 'zoom-out' },
      { label: '&Reset zoom', key: 'Ctrl+Shift+0', when: () => (ui.uiScale || 1) !== 1 || zoomCount() > 0, run: () => resetAllZoom() },
      { label: '&Theme', sub: () => [
        { label: '&Follow Windows', check: () => !ui.theme, run: () => setTheme('') },
        { label: '&Light', check: () => ui.theme === 'light', run: () => setTheme('light') },
        { label: '&Dark', check: () => ui.theme === 'dark', run: () => setTheme('dark') },
      ] },
      { label: '&Full screen', cmd: 'fullscreen' },
    ] },
    { id: 'window', label: '&Window', items: () => [
      { label: '&New window', cmd: 'win-new' },
      { label: '&Move pane to a new window', cmd: 'pane-new-win' },
      { label: 'Move pane &to', when: () => !!focusedId() && otherWins().length > 0, sub: () => otherWins().map(w => ({ label: winLabel(w), run: () => desk.moveSession(focusedId(), w.wid) })) },
      '-',
      { label: '&Close window', cmd: 'win-close' },
      '-',
      ...(snap && snap.windows || []).map(w => ({ label: winLabel(w), check: () => w.wid === myWid, run: () => desk.focusWindow(w.wid) })),
    ] },
    { id: 'help', label: '&Help', items: () => [
      { label: '&Welcome', cmd: 'home' },
      { label: '&Keyboard shortcuts', cmd: 'keys' },
      '-',
      { label: '&Documentation', run: () => desk.openUrl(DOCS) },
      { label: '&Release notes', run: () => desk.openUrl(REPO + '/releases') },
      { label: 'Report an &issue', run: () => desk.openUrl(REPO + '/issues') },
      '-',
      { label: 'Open the &log', cmd: 'open-log' },
      { label: 'Open the &state folder', cmd: 'open-state' },
      '-',
      { label: '&About', run: () => toast(`${appName()} ${snap && snap.app ? snap.app.version : ''}. Electron ${navigator.userAgent.match(/Electron\/([\d.]+)/)?.[1] || ''}.`) },
    ] },
  ];
  const appName = () => (snap && snap.app && snap.app.name) || 'Claude Desk';
  function winLabel(w) {
    const p = w.current && projectByKey(w.current);
    return `&${w.n}  ${p ? p.name : 'no project'}${w.wid === myWid ? '  (this window)' : ''}`;
  }

  // an item's text with its & letter pulled out
  function parse(label) {
    const i = label.indexOf('&');
    return i < 0 ? { pre: label, ch: '', post: '' } : { pre: label.slice(0, i), ch: label[i + 1], post: label.slice(i + 2) };
  }
  function labelEl(label) {
    const { pre, ch, post } = parse(label);
    const s = Dom.h('span', 'lbl');
    s.append(pre); if (ch) { const u = document.createElement('u'); u.textContent = ch; s.append(u); } s.append(post);
    return s;
  }
  function resolve(it) {
    const c = it.cmd ? cmd(it.cmd) : null;
    return {
      label: it.label, sub: it.sub, check: it.check,
      key: it.key || (c && c.key) || '',
      run: it.run || (c && c.run),
      on: (c && c.when ? c.when() : true) && (it.when ? it.when() : true),
      hide: it.hideOff && c && c.when && !c.when(),
    };
  }

  const bar = $('#menubar'), menuEl = $('#menu'), subEl = $('#submenu');
  const M = { top: null, back: null, kb: false, items: [], subItems: [] };
  const folded = () => getComputedStyle($('#mb-fold')).display !== 'none';
  const tops = () => folded() ? [$('#mb-fold')] : [...bar.querySelectorAll('.mb')];

  function fill(el, list) {
    el.textContent = '';
    const out = [];
    for (const raw of list) {
      if (raw === '-') { if (el.lastChild && !el.lastChild.classList.contains('msep')) el.appendChild(Dom.h('div', 'msep')); continue; }
      const it = resolve(raw);
      if (it.hide) continue;
      const r = Dom.h('div', 'mrow' + (it.on ? '' : ' off'));
      r.setAttribute('role', it.check ? 'menuitemcheckbox' : 'menuitem');
      r.tabIndex = -1;
      if (!it.on) r.setAttribute('aria-disabled', 'true');
      if (it.check) r.setAttribute('aria-checked', String(!!it.check()));
      const ck = Dom.h('span', 'mck'); if (it.check && it.check()) ck.appendChild(svgUse('i-check')); r.appendChild(ck);
      r.appendChild(labelEl(it.label));
      if (it.sub) { r.setAttribute('aria-haspopup', 'menu'); const k = Dom.h('span', 'mkey'); k.appendChild(svgUse('i-chev-r')); r.appendChild(k); }
      else r.appendChild(Dom.h('span', 'mkey', it.key));
      r._it = it;
      el.appendChild(r); out.push(r);
    }
    if (el.lastChild && el.lastChild.classList.contains('msep')) el.lastChild.remove();
    return out;
  }
  // keep a menu on screen: under its anchor, or flipped and clamped when the window is small
  function place(el, x, y, flipX) {
    el.style.left = '0px'; el.style.top = '0px'; el.hidden = false;
    const w = el.offsetWidth, h = el.offsetHeight, vw = innerWidth, vh = innerHeight;
    if (x + w > vw - 4) x = flipX != null ? Math.max(4, flipX - w) : Math.max(4, vw - w - 4);
    el.style.left = x + 'px';
    el.style.top = Math.max(4, Math.min(y, vh - h - 4)) + 'px';
    el.style.maxHeight = (vh - 8) + 'px';
  }

  function open(id, kb, focusFirst) {
    closeSub();
    if (!M.top && !bar.contains(document.activeElement)) M.back = document.activeElement;
    for (const p of POPS) if (p !== pop && p.isOpen()) p.open(false);
    M.top = id; M.kb = !!kb;
    document.body.classList.toggle('mnem', M.kb);
    const btn = id === 'fold' ? $('#mb-fold') : bar.querySelector(`.mb[data-menu="${id}"]`);
    for (const b of bar.querySelectorAll('.mb, #mb-fold')) { b.classList.toggle('on', b === btn); b.setAttribute('aria-expanded', String(b === btn)); }
    const list = id === 'fold' ? MENUS.map(m => ({ label: m.label, sub: m.items })) : MENUS.find(m => m.id === id).items();
    M.items = fill(menuEl, list);
    const r = btn.getBoundingClientRect();
    place(menuEl, r.left, r.bottom);
    if (focusFirst !== false) focusRow(M.items, 0, 1);
    else menuEl.focus();
  }
  // a context menu at the pointer, same rows and keys as the bar's menus
  function popup(list, x, y) {
    close(false);
    M.back = document.activeElement;
    for (const p of POPS) if (p !== pop && p.isOpen()) p.open(false);
    M.top = 'ctx'; M.kb = false;
    M.items = fill(menuEl, list);
    place(menuEl, x, y);
    focusRow(M.items, 0, 1);
  }
  function close(restore) {
    if (!M.top) return;
    closeSub();
    M.top = null; menuEl.hidden = true;
    document.body.classList.remove('mnem');
    for (const b of bar.querySelectorAll('.mb, #mb-fold')) { b.classList.remove('on'); b.setAttribute('aria-expanded', 'false'); }
    const back = M.back; M.back = null;
    if (restore !== false) {
      if (back && back.isConnected && back !== document.body) back.focus();
      else { const id = focusedId(); if (id) Terminals.focus(id); }
    }
  }
  function openSub(row, kb) {
    if (subEl._row === row && !subEl.hidden) { if (kb) focusRow(M.subItems, 0, 1); return; }
    closeSub();
    if (!row._it.on) return;
    subEl._row = row; row.classList.add('open');
    M.subItems = fill(subEl, row._it.sub());
    const r = row.getBoundingClientRect();
    place(subEl, r.right - 2, r.top - 5, r.left + 2);
    if (kb) focusRow(M.subItems, 0, 1);
  }
  function closeSub() {
    if (subEl._row) subEl._row.classList.remove('open');
    subEl._row = null; subEl.hidden = true; M.subItems = [];
  }
  function focusRow(rows, i, d) {
    const n = rows.length; if (!n) return;
    for (let k = 0; k < n; k++) { const r = rows[((i + k * d) % n + n) % n]; if (!r.classList.contains('off')) { r.focus(); return; } }
    rows[0].focus();
  }
  function activate(row, kb) {
    const it = row._it;
    if (!it.on) return;
    if (it.sub) { openSub(row, kb); return; }
    close(true);
    if (it.run) it.run();
  }
  function step(d) {
    if (M.top === 'ctx') return;
    const ids = folded() ? ['fold'] : MENUS.map(m => m.id);
    const i = ids.indexOf(M.top);
    open(ids[(i + d + ids.length) % ids.length], true);
  }
  // Alt+letter in folded mode opens that menu as the fold menu's submenu
  function openById(id, kb) {
    if (!folded()) { open(id, kb); return; }
    open('fold', kb);
    const row = M.items[MENUS.findIndex(m => m.id === id)];
    if (row) { row.focus(); openSub(row, kb); }
  }

  const pop = { isOpen: () => !!M.top, open: o => { if (!o) close(true); } };
  POPS.push(pop);

  bar.addEventListener('mousedown', e => {
    const b = e.target.closest('.mb, #mb-fold'); if (!b) return;
    e.preventDefault();
    const id = b.id === 'mb-fold' ? 'fold' : b.dataset.menu;
    if (M.top === id) close(true); else open(id, false, false);
  });
  bar.addEventListener('mouseover', e => {
    const b = e.target.closest('.mb'); if (!b || !M.top || M.top === 'ctx' || M.top === b.dataset.menu) return;
    open(b.dataset.menu, M.kb, false);
  });
  for (const el of [menuEl, subEl]) {
    el.addEventListener('click', e => { const r = e.target.closest('.mrow'); if (r) activate(r, false); });
    el.addEventListener('mouseover', e => {
      const r = e.target.closest('.mrow'); if (!r) return;
      if (!r.classList.contains('off')) r.focus({ preventScroll: true });
      if (el === menuEl) { if (r._it.sub) openSub(r, false); else closeSub(); }
    });
  }
  document.addEventListener('mousedown', e => { if (M.top && !e.target.closest('#menu, #submenu, #menubar')) close(false); }, true);
  window.addEventListener('blur', () => close(false));
  window.addEventListener('resize', () => close(false));

  const inTerminal = () => !!(document.activeElement && document.activeElement.closest('.xterm'));
  let altAlone = false;
  window.addEventListener('keydown', e => {
    if (M.top) {
      const inSub = subEl.contains(document.activeElement);
      const rows = inSub ? M.subItems : M.items;
      const at = rows.indexOf(document.activeElement);
      const k = e.key;
      let used = true;
      if (k === 'ArrowDown') focusRow(rows, at + 1, 1);
      else if (k === 'ArrowUp') focusRow(rows, at < 0 ? rows.length - 1 : at - 1, -1);
      else if (k === 'Home') focusRow(rows, 0, 1);
      else if (k === 'End') focusRow(rows, rows.length - 1, -1);
      else if (k === 'ArrowRight') { const r = rows[at]; if (!inSub && r && r._it.sub) openSub(r, true); else step(1); }
      else if (k === 'ArrowLeft') { if (inSub) { const r = subEl._row; closeSub(); if (r) r.focus(); } else step(-1); }
      else if (k === 'Enter' || k === ' ') { const r = rows[at]; if (r) activate(r, true); }
      else if (k === 'Escape') { if (inSub) { const r = subEl._row; closeSub(); if (r) r.focus(); } else close(true); }
      else if (k === 'Tab') close(true);
      else if (k === 'Alt') { close(true); }
      else if (k.length === 1 && !e.ctrlKey) {
        const hit = rows.find(r => !r.classList.contains('off') && parse(r._it.label).ch.toLowerCase() === k.toLowerCase());
        if (hit) { hit.focus(); activate(hit, true); }
      } else used = false;
      if (used) { e.preventDefault(); e.stopImmediatePropagation(); }
      return;
    }
    if (e.key === 'Alt') { altAlone = !e.ctrlKey && !e.shiftKey && !e.metaKey; return; }
    altAlone = false;
    // Alt+letter belongs to the terminal (Claude Code and readline use it); outside one it opens a menu
    if (e.altKey && !e.ctrlKey && !e.metaKey && !inTerminal() && e.key.length === 1) {
      const m = MENUS.find(m => parse(m.label).ch.toLowerCase() === e.key.toLowerCase());
      if (m) { e.preventDefault(); e.stopImmediatePropagation(); openById(m.id, true); }
    }
  }, true);
  window.addEventListener('keyup', e => {
    if (e.key !== 'Alt' || !altAlone) return;
    altAlone = false;
    if (inTerminal() || M.top) return;
    e.preventDefault();
    openById('file', true);
  }, true);
  window.addEventListener('mousedown', () => { altAlone = false; }, true);

  $('#cmd-centre').addEventListener('click', () => openPalette('jump'));

  // the caption buttons Windows draws take their colours from the theme
  let lastOverlay = '';
  function hex(c) {
    const probe = $('#tb-probe');
    probe.style.color = c;
    const m = getComputedStyle(probe).color.match(/[\d.]+/g) || [0, 0, 0];
    return '#' + m.slice(0, 3).map(v => Math.round(Number(v)).toString(16).padStart(2, '0')).join('');
  }
  function render() {
    const cs = getComputedStyle(document.documentElement);
    const o = { color: hex(cs.getPropertyValue('--surface-0').trim()), symbolColor: hex(cs.getPropertyValue('--ink-2').trim()) };
    const sig = o.color + o.symbolColor;
    if (sig !== lastOverlay) { lastOverlay = sig; desk.titleBar(o); }
    const p = currentProject();
    Dom.text($('#cc-text'), p ? p.name : appName());
    setTitle();
  }
  window.Menubar = { render, open: openById, popup, close: () => close(true), isOpen: () => !!M.top };
})();
