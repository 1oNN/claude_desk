// One xterm per session, created when it is shown; a session hidden for a minute drops its xterm (2000 lines of
// scrollback and a parser each) and gets it back from the main ring when shown again.
const Terminals = (() => {
  // the dark VS Code scheme; applyTheme() in app.js replaces it from the tokens before any bytes land
  const theme = { background: '#0C0C0C', foreground: '#E6E1E2', cursor: '#FF2E4D', cursorAccent: '#0C0C0C', selectionBackground: 'rgba(255, 46, 77, .27)',
    black: '#1F1F1F', red: '#FF8A9B', green: '#8FD694', yellow: '#F2C77A', blue: '#9AB8F5', magenta: '#D7A6E8', cyan: '#8ED3D9', white: '#E6E1E2',
    brightBlack: '#8A8A8A', brightRed: '#FF5C73', brightGreen: '#A9E5AD', brightYellow: '#FFD99A', brightBlue: '#B5CCFA', brightMagenta: '#E6C2F2', brightCyan: '#AEE4E8', brightWhite: '#F7F4F4' };
  const terms = new Map();
  const pool = () => document.getElementById('pool');

  // clipboard and links go through main; tests swap these out
  const io = { read: () => desk.clipRead(), write: t => desk.clipWrite(t), open: u => desk.openUrl(u) };
  const URL_RE = /https?:\/\/[^\s"'<>`]+/g;

  // the default size, and app.js's per-pane sizes on top of it
  let fontSize = 14, sizeOf = () => fontSize;
  let FONT = '"Cascadia Mono", Consolas, "Courier New", monospace';
  const HIDDEN_MS = 60 * 1000;
  // output for a pane you are not typing in is joined and painted at most this often; 8 busy panes cost about a fifth less renderer CPU
  const BACKGROUND_MS = 100;
  function setSizer(fn) { sizeOf = fn; }
  function applySize(r) { const n = sizeOf(r.id); if (r.term && r.term.options.fontSize !== n) r.term.options.fontSize = n; }
  function setFontSize(n) {
    fontSize = n;
    for (const r of terms.values()) applySize(r);
    requestAnimationFrame(fitAll);
  }
  function setFontFamily(f) {
    const next = (f ? `"${f}", ` : '') + '"Cascadia Mono", Consolas, "Courier New", monospace';
    if (next === FONT) return;
    FONT = next;
    for (const r of terms.values()) if (r.term) r.term.options.fontFamily = FONT;
    requestAnimationFrame(fitAll);
  }
  function setSize(id) {
    const r = terms.get(id);
    if (!r || !r.term) return;
    applySize(r);
    if (isPlaced(r)) try { r.fit.fit(); } catch { /* ignore */ }
  }
  function ensure(id) {
    if (terms.has(id)) return terms.get(id);
    const wrap = document.createElement('div');
    wrap.className = 'termwrap';
    wrap.dataset.id = id;
    pool().appendChild(wrap);
    const rec = { id, term: null, fit: null, wrap, overlay: null };
    wrap.addEventListener('contextmenu', e => onContext(rec, e));
    for (const t of ['mousedown', 'mouseup']) wrap.addEventListener(t, e => onRightButton(rec, e), true);
    wrap.addEventListener('paste', e => onPasteEvent(rec, e), true);
    wrap.addEventListener('focusin', () => flush(rec));
    terms.set(id, rec);
    return rec;
  }

  // Windows Terminal habits: Ctrl+C copies when text is selected and is ^C otherwise, Ctrl+Shift+C copies, Ctrl+V and Ctrl+Shift+V paste.
  // Injected keys (Wispr Flow's Ctrl+V) arrive with an empty code, so fall back to the key name.
  const isKey = (e, letter) => e.code === 'Key' + letter || (!e.code && e.key.toUpperCase() === letter);
  function clipKey(id, term, e) {
    if (e.type !== 'keydown' || !e.ctrlKey || e.altKey || e.metaKey) return true;
    if (isKey(e, 'C') && (e.shiftKey || term.hasSelection())) { e.preventDefault(); copy(term); return false; }
    // no preventDefault: the browser paste event that follows carries the clipboard as it was at the keypress,
    // which Wispr restores a moment later, and xterm pastes it from there (onPasteEvent covers an empty one)
    if (isKey(e, 'V')) return false;
    return true;
  }
  // an image-only or empty clipboard still sends ^V, so a program that reads the clipboard itself gets its key
  function onPasteEvent(rec, e) {
    if (e.clipboardData && e.clipboardData.getData('text/plain')) return;
    e.preventDefault(); e.stopPropagation();
    desk.write(rec.id, '\x16');
  }
  function copy(term) {
    if (!term.hasSelection()) return false;
    io.write(term.getSelection()); term.clearSelection();
    return true;
  }
  // right click has no paste event to read, so it goes through main
  async function paste(id, term) {
    let t = ''; try { t = await io.read(); } catch { /* treat as empty */ }
    if (t) term.paste(t); else desk.write(id, '\x16');
  }
  // right click copies the selection, or pastes when there is none; Shift+right click is left for app.js's pane menu.
  // A program with mouse reporting on (Claude Code) pastes on right click itself, so Desk pasting too doubled it.
  const appMouse = term => term.modes.mouseTrackingMode !== 'none';
  function onContext(rec, e) {
    if (!rec.term || e.shiftKey) return;
    e.preventDefault();
    if (!copy(rec.term) && !appMouse(rec.term)) paste(rec.id, rec.term);
  }
  // copying Desk's own selection (Shift+drag) must not also hand the click to the program, which would paste
  function onRightButton(rec, e) {
    if (e.button === 2 && !e.shiftKey && rec.term && rec.term.hasSelection()) e.stopPropagation();
  }
  // plain http(s) URLs in the output, joined across soft wrapped rows; Ctrl+click opens them in the browser
  function linkProvider(rec, term) {
    return { provideLinks(y, cb) {
      const b = term.buffer.active, cols = term.cols;
      let top = y - 1; while (top > 0 && b.getLine(top) && b.getLine(top).isWrapped) top--;
      let bot = y - 1; while (bot - top < 20 && b.getLine(bot + 1) && b.getLine(bot + 1).isWrapped) bot++;
      let s = ''; for (let i = top; i <= bot; i++) s += b.getLine(i).translateToString(i === bot);
      const links = [];
      for (const m of s.matchAll(URL_RE)) {
        const u = m[0].replace(/[.,;:!?)\]}'"]+$/, ''), a = m.index, z = a + u.length - 1;
        const sy = top + Math.floor(a / cols) + 1, ey = top + Math.floor(z / cols) + 1;
        if (y < sy || y > ey) continue;
        links.push({ range: { start: { x: a % cols + 1, y: sy }, end: { x: z % cols + 1, y: ey } }, text: u, decorations: { underline: true, pointerCursor: true },
          hover: () => { rec.wrap.title = 'Ctrl+click to open ' + u; }, leave: () => { rec.wrap.removeAttribute('title'); },
          activate: (e, t) => { if (e.ctrlKey) io.open(t); } });
      }
      cb(links.length ? links : undefined);
    } };
  }

  function isPlaced(rec) { return !!(rec.wrap.parentElement && rec.wrap.parentElement.classList.contains('slot')); }

  async function place(id, slotEl) {
    const rec = ensure(id);
    for (const w of slotEl.querySelectorAll(':scope > .termwrap')) if (w !== rec.wrap) pool().appendChild(w);
    const empty = slotEl.querySelector('.slot-empty'); if (empty) empty.remove();
    if (rec.wrap.parentElement !== slotEl) slotEl.appendChild(rec.wrap);
    clearTimeout(rec.drop); rec.drop = null;
    if (!rec.term) {
      // minimumContrastRatio lifts grey and dim output to 4.5:1 against the background, the WCAG bar for small text
      const term = new Terminal({ theme, fontSize: sizeOf(id), fontFamily: FONT, lineHeight: 1.2, minimumContrastRatio: 4.5, cursorStyle: 'block', cursorBlink: false, allowProposedApi: true, scrollback: 2000, windowsPty: { backend: 'conpty' },
        linkHandler: { activate: (e, uri) => { if (e.ctrlKey && /^https?:/i.test(uri)) io.open(uri); }, allowNonHttpProtocols: false } });
      const fit = new FitAddon.FitAddon();
      term.loadAddon(fit);
      term.open(rec.wrap);
      if (rec.overlay) rec.wrap.appendChild(rec.overlay);
      rec.term = term; rec.fit = fit;
      try { fit.fit(); } catch { /* not measurable yet */ }
      term.onData(d => desk.write(id, d));
      term.attachCustomKeyEventHandler(e => clipKey(id, term, e));
      term.registerLinkProvider(linkProvider(rec, term));
      term.onResize(({ cols, rows }) => desk.resize(id, cols, rows));
      const r = await desk.attach(id, term.cols, term.rows);
      if (r && r.replay) term.write(r.replay);
      if (r && r.error) overlay(id, r.error, false);
      setTimeout(() => wiggle(id), 150);
    } else {
      // the xterm kept parsing while hidden, so its screen is current; a size change from fit resizes the pty and the TUI redraws on its own
      flush(rec);
      applySize(rec);
      try { rec.fit.fit(); } catch { /* ignore */ }
    }
    rec.term.focus();
  }

  function unplace(id) {
    const rec = terms.get(id);
    if (!rec || !isPlaced(rec)) return;
    pool().appendChild(rec.wrap);
    clearTimeout(rec.drop);
    rec.drop = setTimeout(() => { rec.drop = null; if (!isPlaced(rec)) dropTerm(rec); }, HIDDEN_MS);
  }
  function dropTerm(rec) {
    clearTimeout(rec.flushT); rec.flushT = null; rec.pend = '';
    if (!rec.term) return;
    rec.term.dispose(); rec.term = null; rec.fit = null;
    for (const x of rec.wrap.querySelectorAll(':scope > .xterm')) x.remove();
  }
  function hidden() { let n = 0; for (const r of terms.values()) if (!r.term) n++; return n; }

  function write(id, d) {
    const rec = terms.get(id);
    if (!rec || !rec.term) return;
    if (rec.wrap.contains(document.activeElement)) { if (rec.pend) flush(rec); rec.term.write(d); return; }
    rec.pend = (rec.pend || '') + d;
    if (!rec.flushT) rec.flushT = setTimeout(() => flush(rec), BACKGROUND_MS);
  }
  function flush(rec) {
    clearTimeout(rec.flushT); rec.flushT = null;
    if (rec.pend && rec.term) rec.term.write(rec.pend);
    rec.pend = '';
  }

  function fitAll() {
    for (const rec of terms.values()) if (rec.term && isPlaced(rec)) { try { rec.fit.fit(); } catch { /* ignore */ } }
  }

  // the fullscreen TUI only redraws on a size change, so a pane rebuilt from the ring replay gets one
  function wiggle(id) {
    const rec = terms.get(id);
    if (!rec || !rec.term || !isPlaced(rec)) return;
    const { cols, rows } = rec.term;
    if (cols < 2 || rows < 2) return;
    desk.resize(id, cols - 1, rows);
    setTimeout(() => desk.resize(id, cols, rows), 60);
  }

  function overlay(id, msg, resumable) {
    const rec = ensure(id);
    clearOverlay(id);
    const o = document.createElement('div');
    o.className = 'overlay';
    const copy = typeof msg === 'string' ? { title: msg } : msg;
    const m = document.createElement('div'); m.className = 'msg'; m.textContent = copy.title; o.appendChild(m);
    if (copy.detail) { const d = document.createElement('div'); d.className = 'sub'; d.textContent = copy.detail; o.appendChild(d); }
    if (resumable) {
      const b = document.createElement('button'); b.textContent = 'Resume';
      b.onclick = () => { m.textContent = 'Resuming'; b.disabled = true; desk.resumeSession(id); };
      o.appendChild(b);
    }
    rec.wrap.appendChild(o);
    rec.overlay = o;
  }
  function clearOverlay(id) { const rec = terms.get(id); if (rec && rec.overlay) { rec.overlay.remove(); rec.overlay = null; } }

  async function restarted(id) {
    const rec = terms.get(id);
    clearOverlay(id);
    if (!rec || !rec.term) return;
    clearTimeout(rec.flushT); rec.flushT = null; rec.pend = '';
    rec.term.reset();
    if (!isPlaced(rec)) return;
    const r = await desk.attach(id, rec.term.cols, rec.term.rows);
    if (r && r.replay) rec.term.write(r.replay);
    if (r && r.error) overlay(id, r.error, false);
    setTimeout(() => wiggle(id), 200);
  }

  function dispose(id) {
    const rec = terms.get(id);
    if (!rec) return;
    clearTimeout(rec.drop); clearTimeout(rec.flushT);
    if (rec.term) rec.term.dispose();
    rec.wrap.remove();
    terms.delete(id);
  }

  function focus(id) { const rec = terms.get(id); if (rec && rec.term) rec.term.focus(); }

  return { io, ensure, place, unplace, write, fitAll, setFontSize, setFontFamily, setSizer, setSize, wiggle, overlay, clearOverlay, restarted, dispose, focus, hidden, hasOverlay: id => { const r = terms.get(id); return !!(r && r.overlay); }, get: id => terms.get(id), isPlaced: id => { const r = terms.get(id); return !!(r && isPlaced(r)); } };
})();
