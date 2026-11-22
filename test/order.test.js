require('./_env');
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { sortProjects, reorderSessions } = require('../src/main/order');
const S = require('../src/main/state');

test('folders in the saved order come first, the rest alphabetical', () => {
  assert.deepStrictEqual(sortProjects(['F:\\b', 'F:\\a', 'F:\\c'], ['F:\\c', 'F:\\a'], path.win32.basename), ['F:\\c', 'F:\\a', 'F:\\b']);
});

test('a saved folder that no longer exists is ignored', () => {
  assert.deepStrictEqual(sortProjects(['F:\\B', 'F:\\a'], ['F:\\gone', 'F:\\B'], path.win32.basename), ['F:\\B', 'F:\\a']);
});

test('with no saved order the folders are alphabetical, ignoring case', () => {
  assert.deepStrictEqual(sortProjects(['F:\\b', 'F:\\A', 'F:\\c'], [], path.win32.basename), ['F:\\A', 'F:\\b', 'F:\\c']);
});

const ses = () => [
  { id: 's1', machine: 'pc', project: 'F:\\a', order: 1 },
  { id: 's2', machine: 'pc', project: 'F:\\b', order: 2 },
  { id: 's3', machine: 'pc', project: 'F:\\a', order: 3 },
];

test('reordering chats swaps their order numbers and leaves other projects alone', () => {
  const s = ses();
  assert.strictEqual(reorderSessions(s, ['s3', 's1']), true);
  assert.deepStrictEqual(s.map(x => [x.id, x.order]), [['s1', 3], ['s2', 2], ['s3', 1]]);
});

test('chats from two projects cannot be reordered together', () => {
  const s = ses();
  assert.strictEqual(reorderSessions(s, ['s2', 's1']), false);
  assert.deepStrictEqual(s.map(x => x.order), [1, 2, 3]);
});

test('an unknown chat id refuses the reorder', () => {
  const s = ses();
  assert.strictEqual(reorderSessions(s, ['s1', 'nope']), false);
  assert.deepStrictEqual(s.map(x => x.order), [1, 2, 3]);
});

test('a state with no saved folder order gets an empty one per machine', () => {
  try { fs.unlinkSync(S.FILE); } catch { /* none */ }
  assert.deepStrictEqual(S.load().projectOrder, { pc: [], laptop: [] });
});
