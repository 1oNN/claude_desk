// The stack view's rules: chats from any project, one pane each, always in sidebar order (folder, then chat).
const Stack = (() => {
  const MAX = 8;

  function rank(snap) {
    const pidx = new Map(snap.projects.map((p, i) => [p.machine + ':' + p.dir, i]));
    const of = new Map(snap.sessions.map(s => {
      const p = pidx.get(s.machine + ':' + s.project);
      return [s.id, (p == null ? snap.projects.length : p) * 1e9 + (s.order || 0)];
    }));
    return id => of.has(id) ? of.get(id) : Infinity;
  }

  function sort(v, rank) {
    const focused = v.slots[v.focus];
    const head = v.slots.slice(0, v.n).map((id, i) => ({ id, i }));
    head.sort((a, b) => (a.id === null) - (b.id === null) || (a.id === null ? a.i - b.i : (rank(a.id) - rank(b.id)) || a.i - b.i));
    head.forEach((x, i) => { v.slots[i] = x.id; });
    if (focused) v.focus = v.slots.indexOf(focused);
  }

  function add(v, id, rank, max = MAX) {
    const at = v.slots.slice(0, v.n).indexOf(id);
    if (at >= 0) { v.focus = at; return; }
    const prev = v.slots.indexOf(id);
    if (prev >= 0) { v.slots.splice(prev, 1); v.slots.push(null); }
    const empty = v.slots.slice(0, v.n).indexOf(null);
    if (empty >= 0) v.slots[empty] = id;
    else if (v.n < max) { v.slots[v.n] = id; v.n++; }
    else v.slots[v.focus] = id;
    v.focus = v.slots.indexOf(id);
    sort(v, rank);
  }

  function removeFrom(v, id) {
    const i = v.slots.indexOf(id);
    if (i < 0) return;
    v.slots.splice(i, 1); v.slots.push(null);
    if (i >= v.n) return;
    v.n = Math.max(1, v.n - 1);
    if (v.focus > i || v.focus >= v.n) v.focus = Math.max(0, v.focus - 1);
  }

  return { MAX, rank, sort, add, removeFrom };
})();
if (typeof module !== 'undefined') module.exports = Stack;
