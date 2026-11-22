// The order the owner drags folders and chats into. Folders keep a saved list per machine, chats their order numbers.

function sortProjects(dirs, order, base) {
  const at = new Map((order || []).map((d, i) => [d, i]));
  return dirs.slice().sort((a, b) => {
    const ia = at.has(a) ? at.get(a) : Infinity, ib = at.has(b) ? at.get(b) : Infinity;
    if (ia !== ib) return ia - ib;
    return base(a).localeCompare(base(b), undefined, { sensitivity: 'base' });
  });
}

// the ids take over the order numbers they already hold, so chats in other projects keep their place
function reorderSessions(sessions, ids) {
  const list = ids.map(id => sessions.find(s => s.id === id));
  if (!list.length || list.some(s => !s)) return false;
  if (list.some(s => s.machine !== list[0].machine || s.project !== list[0].project)) return false;
  const nums = list.map(s => s.order || 0).sort((a, b) => a - b);
  list.forEach((s, i) => { s.order = nums[i]; });
  return true;
}

module.exports = { sortProjects, reorderSessions };
