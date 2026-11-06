// Sidebar: machines, the projects that have sessions, an "all folders" picker for the rest. One flat keyed list; rows are patched in place, never rebuilt.
const Sidebar = (() => {
  const el = document.getElementById('sidebar-scroll');
  const { h, text, attr } = Dom;
  const GLYPHS = ['spin', 'asking', 'done', 'running', 'failed', 'idle', 'shell', 'exited', 'offline', 'elsewhere', 'starting'];
  const SYMBOL = { spin: 'working', asking: 'waiting', done: 'finished', running: 'working', failed: 'failed', idle: 'idle', shell: 'shell', exited: 'exited', offline: 'offline', elsewhere: 'elsewhere', starting: 'starting' };
  // the one state word table; app.js reads it too, so a row, the home list, the palette and the tooltips say the same thing
  const WORD = { working: 'working', waiting: 'needs you', finished: 'finished', failed: 'failed', idle: 'idle', exited: 'exited', stopped: 'stopped', offline: 'offline', starting: 'starting', queued: 'queued', elsewhere: 'elsewhere', shell: 'shell' };

  function svgUse(id, cls) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    svg.setAttribute('class', cls || 'g');
    use.setAttribute('href', id);
    svg.appendChild(use);
    return svg;
  }
  function glyphEl() {
    const g = h('span', 'glyph');
    g.appendChild(svgUse('#g-idle', ''));
    return g;
  }
  function setGlyph(g, kind) {
    if (!SYMBOL[kind]) kind = 'idle';
    for (const k of GLYPHS) g.classList.toggle(k, k === kind);
    attr(g.firstChild.firstChild, 'href', '#g-' + SYMBOL[kind]);
  }
  function glyphOf(s) { return (s.status === 'starting' || s.status === 'queued') ? 'starting' : s.glyph; }
  function fmtMem(b) {
    if (!b) return '';
    const mb = b / 1048576;
    return mb >= 1024 ? (mb / 1024).toFixed(1) + ' GB' : Math.round(mb) + ' MB';
  }
  // one word for the state column, and the token suffix that colours it
  function stateOf(s) {
    if (s.status !== 'live') return s.status === 'starting' || s.status === 'queued' ? 'starting' : s.status;
    if (s.kind === 'shell') return 'shell';
    if (s.glyph === 'failed') return 'failed';
    return s.state || 'idle';
  }
  const TONE = { stopped: 'exited', queued: 'starting' };
  function ibtn(id, title, act) {
    const b = h('button', 'ibtn');
    b.appendChild(svgUse(id));
    b.title = title; b.dataset.act = act; b.type = 'button'; b.tabIndex = -1;
    if (title) b.setAttribute('aria-label', title);
    return b;
  }
  function accChip() { return h('span', 'acc'); }
  function setAcc(chip, n) {
    text(chip, String(n));
    const v = `var(--acc-${n})`, vs = `var(--acc-${n}-strong)`;
    if (chip.style.getPropertyValue('--acc') !== v) { chip.style.setProperty('--acc', v); chip.style.setProperty('--acc-strong', vs); }
  }

  let lastSig = '';
  function signature(snap, ui) {
    return JSON.stringify([
      snap.projects.map(p => [p.key, p.badge, p.mem, p.foreign.map(f => [f.name, f.regStatus, f.mem, f.account])]),
      snap.sessions.map(s => [s.id, s.name, s.status, s.state, s.glyph, s.label, s.mem, s.elsewhere, s.error, s.account, s.order]),
      snap.laptop, snap.totals, ui.current, ui.expanded, ui.views[ui.current], ui.showMem, ui.picker,
    ]);
  }

  // rows are buttons for the keyboard and the screen reader; the icon buttons inside are reached with the right arrow
  function focusable(r) { r.tabIndex = 0; r.setAttribute('role', 'button'); }

  // ---- row factories: children are made once, update() toggles and fills them ----
  const create = {
    machine(it) {
      const r = h('div', 'machine');
      r.appendChild(h('span', 'name', it.machine === 'pc' ? 'PC' : 'Laptop'));
      r.appendChild(h('span', 'mem'));
      const chip = h('span', 'chip'); chip.appendChild(h('span', 'dot')); chip.appendChild(h('span', 'ctext')); chip.hidden = true; r.appendChild(chip);
      const b = h('button', 'ibtn text', 'reconnect'); b.dataset.act = 'reconnect'; b.title = 'Reconnect to the laptop'; b.hidden = true; r.appendChild(b);
      return r;
    },
    project() {
      const r = h('div', 'project'); focusable(r);
      const chev = h('button', 'ibtn chev'); chev.appendChild(svgUse('#i-chev')); chev.dataset.act = 'toggle'; chev.title = 'Collapse'; chev.tabIndex = -1; chev.type = 'button'; r.appendChild(chev);
      r.appendChild(h('span', 'pname'));
      r.appendChild(h('span', 'count'));
      r.appendChild(h('span', 'mem'));
      r.appendChild(h('span', 'pbadge wait'));
      r.appendChild(ibtn('#i-plus', 'New session here', 'new'));
      return r;
    },
    session() {
      const r = h('div', 'session'); focusable(r);
      r.appendChild(accChip());
      r.appendChild(h('span', 'sname'));
      const st = h('span', 'state'); st.appendChild(glyphEl()); st.appendChild(h('span', 'word')); r.appendChild(st);
      r.appendChild(h('span', 'label'));
      r.appendChild(h('span', 'smem'));
      const acts = h('span', 'acts');
      const re = h('button', 'ibtn text', 'resume'); re.dataset.act = 'resume'; re.title = 'Resume this session'; re.type = 'button'; re.tabIndex = -1; acts.appendChild(re);
      acts.appendChild(ibtn('#i-x', '', 'stop'));
      r.appendChild(acts);
      return r;
    },
    foreign() {
      const r = h('div', 'foreign');
      r.appendChild(accChip());
      r.appendChild(h('span', 'sname'));
      r.appendChild(h('span', 'smem'));
      r.appendChild(glyphEl());
      r.appendChild(h('span', 'where', 'not Desk'));
      return r;
    },
    all() {
      const r = h('div', 'allfolders'); focusable(r);
      r.appendChild(svgUse('#i-folder'));
      r.appendChild(h('span', 'ftext'));
      r.appendChild(svgUse('#i-chev-r', 'g chev'));
      return r;
    },
    pick() {
      const r = h('div', 'pick'); focusable(r);
      r.appendChild(h('span', 'pname'));
      r.appendChild(h('span', 'count'));
      return r;
    },
    add() {
      const r = h('div', 'pick addrow'); focusable(r); r.setAttribute('aria-label', 'Add a folder');
      r.appendChild(svgUse('#i-plus'));
      r.appendChild(h('span', 'pname', 'Add a folder'));
      return r;
    },
  };

  const update = {
    machine(r, it) {
      const [, mem, chip, btn] = r.children;
      if (it.machine === 'laptop') {
        const L = it.laptop;
        chip.hidden = false;
        chip.classList.toggle('conn', L.status === 'connecting');
        chip.classList.toggle('off', L.status !== 'online' && L.status !== 'connecting');
        text(chip.lastChild, L.status === 'online' ? 'online' : L.status);
        attr(chip, 'title', L.error && L.status !== 'online' ? L.error : null);
        btn.hidden = L.status === 'online' || L.status === 'connecting';
        mem.hidden = !it.showMem;
        text(mem, fmtMem(it.total) + (L.mem && L.mem.MemAvailable != null ? `, free ${Math.round(L.mem.MemAvailable / 1024 * 10) / 10} GB` : ''));
      } else {
        mem.hidden = !it.showMem;
        text(mem, fmtMem(it.total));
      }
    },
    project(r, it) {
      const p = it.p;
      const [chev, name, count, mem, badge, plus] = r.children;
      r.classList.toggle('current', it.current);
      r.classList.toggle('open', it.expanded);
      attr(r, 'title', p.dir);
      chev.hidden = !it.hasRows;
      attr(chev, 'title', it.expanded ? 'Collapse' : 'Expand'); attr(chev, 'aria-label', it.expanded ? 'Collapse' : 'Expand');
      attr(r, 'aria-expanded', it.hasRows ? String(!!it.expanded) : null);
      attr(r, 'aria-label', `${p.name}, ${it.count} session${it.count === 1 ? '' : 's'}${p.badge ? `, ${p.badge} need you` : ''}${it.current ? ', current project' : ''}`);
      text(name, p.name);
      count.hidden = !it.count; text(count, it.count ? String(it.count) : '');
      mem.hidden = !it.showMem || !p.mem; text(mem, fmtMem(p.mem));
      badge.hidden = !p.badge; text(badge, p.badge ? String(p.badge) : '');
      attr(badge, 'title', p.badge ? `${p.badge} waiting or finished` : null);
      attr(plus, 'title', `New session in ${p.name}`);
    },
    session(r, it) {
      const s = it.s;
      const [acc, name, st, label, mem, acts] = r.children;
      const [re, x] = acts.children;
      r.classList.toggle('placed', it.placed);
      r.classList.toggle('focused', it.focused);
      r.classList.toggle('hasmem', it.showMem);
      setAcc(acc, s.account || 0);
      attr(acc, 'title', s.account ? (typeof accName === 'function' && s.machine === 'pc' ? accName(s.account) : `claude-${s.account}`) : 'shell');
      text(name, s.name);
      attr(name, 'title', s.name);
      setGlyph(st.firstChild, glyphOf(s));
      const word = s.status === 'elsewhere' && s.elsewhere ? `elsewhere as ${s.elsewhere}` : (WORD[it.state] || it.state);
      text(st.lastChild, word);
      attr(st, 'title', s.error || null);
      attr(r, 'aria-label', `${s.name}, ${word}${s.label ? ', ' + s.label : ''}${it.placed ? ', shown' : ''}`);
      const tone = `var(--st-${TONE[it.state] || it.state})`;
      if (st.style.getPropertyValue('--st') !== tone) st.style.setProperty('--st', tone);
      text(label, s.label || ''); attr(label, 'title', s.label || null);
      mem.hidden = !it.showMem; text(mem, fmtMem(s.mem));
      const running = s.status === 'live' || s.status === 'starting' || s.status === 'queued';
      const parked = s.status === 'elsewhere' || s.status === 'offline';
      re.hidden = running || parked;
      x.hidden = !running && s.status === 'offline';
      x.dataset.act = running ? 'stop' : 'forget';
      attr(x, 'title', running ? 'Stop (it can be resumed later)' : 'Forget this session');
      attr(x, 'aria-label', running ? `Stop ${s.name}` : `Forget ${s.name}`);
    },
    foreign(r, it) {
      const f = it.f;
      const [acc, name, mem, glyph] = r.children;
      attr(r, 'title', `${f.name}\n${f.cwd}\nstarted outside Desk (a terminal or VS Code)`);
      setAcc(acc, f.account || 0);
      text(name, f.name);
      mem.hidden = !it.showMem; text(mem, fmtMem(f.mem));
      setGlyph(glyph, f.regStatus === 'busy' ? 'spin' : f.regStatus === 'waiting' ? 'asking' : 'idle');
    },
    all(r, it) {
      r.classList.toggle('open', it.open);
      text(r.children[1], it.open ? 'All folders' : `All folders (${it.n})`);
      attr(r, 'title', it.open ? 'Hide the folder list' : 'Pick any folder to work in');
      attr(r, 'aria-expanded', String(!!it.open));
    },
    pick(r, it) {
      r.classList.toggle('current', it.current);
      attr(r, 'title', it.p.dir);
      text(r.firstChild, it.p.name);
      attr(r, 'aria-label', `Open ${it.p.name}`);
      r.lastChild.hidden = !it.p.foreign.length; text(r.lastChild, it.p.foreign.length ? `${it.p.foreign.length} outside Desk` : '');
    },
    add() {},
  };

  function items(snap, ui) {
    const out = [];
    const view = ui.views[ui.current] || { slots: [], focus: 0 };
    const placed = new Set(view.slots.filter(Boolean));
    const focusedId = view.slots[view.focus];
    const showMem = !!ui.showMem;
    const picker = ui.picker || {};
    for (const machine of (snap.laptop.status === 'off' ? ['pc'] : ['pc', 'laptop'])) {
      out.push({ k: 'm:' + machine, t: 'machine', machine, laptop: snap.laptop, total: snap.totals[machine], showMem });
      const rest = [];
      for (const p of snap.projects.filter(x => x.machine === machine)) {
        const sessions = snap.sessions.filter(s => s.machine === machine && s.project === p.dir).sort((a, b) => a.order - b.order);
        const hasRows = !!(sessions.length || p.foreign.length);
        const current = ui.current === p.key;
        if (!hasRows && !current) { rest.push(p); continue; }
        const expanded = ui.expanded[p.key] != null ? ui.expanded[p.key] : hasRows;
        out.push({ k: 'p:' + p.key, t: 'project', p, hasRows, expanded, current, count: sessions.length, showMem });
        if (!expanded) continue;
        for (const s of sessions) out.push({ k: 's:' + s.id, t: 'session', s, state: stateOf(s), placed: placed.has(s.id), focused: focusedId === s.id, showMem });
        p.foreign.forEach((f, i) => out.push({ k: `f:${p.key}:${f.sid || f.cwd + f.name}:${i}`, t: 'foreign', f, showMem }));
      }
      const open = !!picker[machine];
      out.push({ k: 'all:' + machine, t: 'all', machine, open, n: rest.length });
      if (open) {
        for (const p of rest) out.push({ k: 'pk:' + p.key, t: 'pick', p, current: false });
        out.push({ k: 'add:' + machine, t: 'add', machine });
      }
    }
    return out;
  }
  const SIG = {
    machine: it => JSON.stringify([it.laptop, it.total, it.showMem]),
    project: it => JSON.stringify([it.p.name, it.p.dir, it.p.badge, it.p.mem, it.hasRows, it.expanded, it.current, it.count, it.showMem]),
    session: it => JSON.stringify([it.s.name, it.s.status, it.s.glyph, it.s.label, it.s.mem, it.s.elsewhere, it.s.error, it.s.account, it.state, it.placed, it.focused, it.showMem]),
    foreign: it => JSON.stringify([it.f.name, it.f.sid, it.f.cwd, it.f.regStatus, it.f.mem, it.f.account, it.showMem]),
    all: it => JSON.stringify([it.open, it.n]),
    pick: it => JSON.stringify([it.p.name, it.p.dir, it.p.foreign.length, it.current]),
    add: () => '',
  };

  let last = { snap: null, ui: null, H: null };
  function render(snap, ui, H, force) {
    const sig = signature(snap, ui);
    last = { snap, ui, H };
    if (!force && sig === lastSig) return;
    lastSig = sig;
    Dom.keyed(el, items(snap, ui), it => it.k, it => create[it.t](it), (r, it) => update[it.t](r, it), { sig: it => it.t + SIG[it.t](it), force });
  }

  // clicks are delegated and read the current snapshot, so a row never holds a stale session object
  el.addEventListener('click', e => {
    const { snap, ui, H } = last;
    if (!snap) return;
    const row = e.target.closest('[data-key]');
    if (!row || Dom.isLeaving(row)) return;
    const a = e.target.closest('[data-act]');
    const act = a && row.contains(a) ? a.dataset.act : null;
    const key = row.dataset.key, kind = key.slice(0, key.indexOf(':')), id = key.slice(kind.length + 1);
    if (kind === 'm') { if (act === 'reconnect') H.onReconnect(); return; }
    if (kind === 'all') { H.onPicker(id, !(ui.picker && ui.picker[id])); return; }
    if (kind === 'add') { H.onAddProject(id); return; }
    if (kind === 'pk') { H.onPick(id); return; }
    if (kind === 'p') {
      const p = snap.projects.find(x => x.key === id);
      if (!p) return;
      if (act === 'toggle') { const it = items(snap, ui).find(x => x.k === key); H.onToggle(p.key, !(it && it.expanded)); }
      else if (act === 'new') H.onNewSession(p);
      else H.onProject(p.key);
      return;
    }
    if (kind === 's') {
      const s = snap.sessions.find(x => x.id === id);
      if (!s) return;
      if (act === 'stop') H.onStop(s);
      else if (act === 'forget') H.onForget(s);
      else if (act === 'resume') H.onResume(s);
      else H.onSession(s);
    }
  });

  // keyboard: Enter or Space acts like a click on the row, Up and Down walk the rows, Right reaches the row's buttons (or expands), Left goes back (or collapses), Delete stops or forgets a session
  el.addEventListener('keydown', e => {
    const { snap, H } = last;
    const row = e.target.closest('[data-key]');
    if (!row || !snap) return;
    const onRow = e.target === row;
    const key = row.dataset.key, kind = key.slice(0, key.indexOf(':')), id = key.slice(kind.length + 1);
    const buttons = () => [...row.querySelectorAll('button')].filter(b => !b.hidden && !b.closest('[hidden]'));
    if ((e.key === 'Enter' || e.key === ' ') && onRow) { e.preventDefault(); row.click(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const rows = [...el.querySelectorAll('[data-key][tabindex="0"]')];
      const n = rows[rows.indexOf(row) + (e.key === 'ArrowDown' ? 1 : -1)];
      if (n) n.focus();
      return;
    }
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      if (kind === 'p' && onRow && row.getAttribute('aria-expanded') === 'false') { H.onToggle(id, true); return; }
      if (kind === 'all' && onRow && row.getAttribute('aria-expanded') === 'false') { H.onPicker(id, true); return; }
      const bs = buttons(); if (!bs.length) return;
      const i = bs.indexOf(e.target);
      (i < 0 ? bs[0] : bs[i + 1] || row).focus();
      return;
    }
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (!onRow) { row.focus(); return; }
      if (kind === 'p' && row.getAttribute('aria-expanded') === 'true') H.onToggle(id, false);
      else if (kind === 'all' && row.getAttribute('aria-expanded') === 'true') H.onPicker(id, false);
      return;
    }
    if (e.key === 'Delete' && kind === 's' && onRow) { const x = row.querySelector('[data-act="stop"], [data-act="forget"]'); if (x && !x.hidden) { e.preventDefault(); x.click(); } }
  });

  return { render, glyphEl, setGlyph, glyphOf, fmtMem, svgUse, stateOf, WORD };
})();
