// Keyed, in-place list rendering. Children carry data-key; a node that is still wanted is patched,
// a new one enters, a gone one leaves, and nothing else is rebuilt, so hover, focus, scroll position
// and running animations survive every snapshot.
const Dom = (() => {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  // durations and easings come from the motion tokens, so the stylesheet and the Web Animations agree and reduced motion zeroes both
  const token = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const ms = name => parseFloat(token(name)) || 0;
  const ease = name => token(name) || 'ease';
  const ENTER = [{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }];
  const LEAVE = [{ opacity: 1 }, { opacity: 0 }];
  const painted = new WeakSet(); // containers that have rendered once; the first paint never animates
  const leaving = new WeakMap(); // el -> leave Animation

  // longest increasing subsequence over indexes; the nodes in it keep their place, the rest move
  function lis(seq) {
    const tails = [], prev = new Array(seq.length);
    for (let i = 0; i < seq.length; i++) {
      let lo = 0, hi = tails.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (seq[tails[mid]] < seq[i]) lo = mid + 1; else hi = mid; }
      prev[i] = lo ? tails[lo - 1] : -1;
      tails[lo] = i;
    }
    const out = new Set();
    for (let k = tails.length ? tails[tails.length - 1] : -1; k >= 0; k = prev[k]) out.add(k);
    return out;
  }

  function leave(el, animate) {
    el.classList.add('leaving');
    if (!animate) { el.remove(); return; }
    const a = el.animate(LEAVE, { duration: ms('--t-leave'), easing: ease('--ease-exit'), fill: 'forwards' });
    leaving.set(el, a);
    a.onfinish = () => { if (leaving.get(el) === a) el.remove(); };
  }

  function reclaim(el) {
    const a = leaving.get(el);
    if (!a) return false;
    a.onfinish = null; a.cancel();
    leaving.delete(el);
    el.classList.remove('leaving');
    return true;
  }

  // opts: { sig(item) -> string, force }. update(el, item) runs only when the signature changed.
  function keyed(container, items, keyOf, create, update, opts = {}) {
    if (container.closest('#slots, .termwrap')) throw new Error('keyed() must not touch a terminal');
    const first = !painted.has(container);
    painted.add(container);
    const animate = !first && !reduced.matches;
    const enterAnim = animate && !opts.force;
    const want = new Map();
    items.forEach((item, i) => want.set(keyOf(item), i));

    // existing nodes in DOM order: keep the wanted ones, start the rest leaving
    const have = new Map(), order = [];
    for (const el of [...container.children]) {
      const k = el.dataset.key;
      if (want.has(k) && !have.has(k)) { reclaim(el); have.set(k, el); order.push(want.get(k)); }
      else if (!leaving.has(el)) leave(el, animate);
    }
    const stable = lis(order);
    const stableKeys = new Set();
    let j = 0;
    for (const [k] of have) { if (stable.has(j)) stableKeys.add(k); j++; }

    // walk backwards so each node is placed before its successor; stable nodes never move
    let next = null;
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i], k = keyOf(item);
      let el = have.get(k);
      const sig = opts.sig ? opts.sig(item) : null;
      if (!el) {
        el = create(item);
        el.dataset.key = k;
        container.insertBefore(el, next);
        if (enterAnim) el.animate(ENTER, { duration: ms('--t-enter'), easing: ease('--ease-enter') });
      } else if (!stableKeys.has(k)) {
        container.insertBefore(el, next);
      }
      if (sig === null || el.dataset.sig !== sig) { update(el, item); if (sig !== null) el.dataset.sig = sig; }
      next = el;
    }
  }

  function h(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  // sets textContent only when it changed, so a selection or a running style is not disturbed
  function text(el, s) { if (el.textContent !== s) el.textContent = s; }
  function attr(el, name, v) {
    if (v == null || v === '') { if (el.hasAttribute(name)) el.removeAttribute(name); }
    else if (el.getAttribute(name) !== String(v)) el.setAttribute(name, v);
  }

  return { keyed, h, text, attr, ms, ease, isLeaving: el => leaving.has(el) };
})();
