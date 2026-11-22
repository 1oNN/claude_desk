const test = require('node:test');
const assert = require('node:assert');
const Stack = require('../src/renderer/stack');

const E = () => Array(8).fill(null);
const v0 = () => ({ n: 1, slots: E(), focus: 0, stack: true });
// project a holds a1 a2, project b holds b1; a is above b in the sidebar
const snap = {
  projects: [{ machine: 'pc', dir: 'A' }, { machine: 'pc', dir: 'B' }],
  sessions: [{ id: 'b1', machine: 'pc', project: 'B', order: 1 }, { id: 'a2', machine: 'pc', project: 'A', order: 5 }, { id: 'a1', machine: 'pc', project: 'A', order: 2 }],
};
const rank = Stack.rank(snap);
const shown = v => v.slots.slice(0, v.n);

test('the first chat fills the empty stack', () => {
  const v = v0();
  Stack.add(v, 'b1', rank);
  assert.deepStrictEqual(shown(v), ['b1']);
  assert.strictEqual(v.focus, 0);
});

test('a second chat adds a pane and the stack follows sidebar order', () => {
  const v = v0();
  Stack.add(v, 'b1', rank); Stack.add(v, 'a2', rank);
  assert.deepStrictEqual(shown(v), ['a2', 'b1']);
  assert.strictEqual(v.slots[v.focus], 'a2');
});

test('adding a chat already there only focuses it', () => {
  const v = v0();
  Stack.add(v, 'b1', rank); Stack.add(v, 'a1', rank); Stack.add(v, 'b1', rank);
  assert.deepStrictEqual(shown(v), ['a1', 'b1']);
  assert.strictEqual(v.slots[v.focus], 'b1');
});

test('a ninth chat replaces the focused pane and the stack stays at 8', () => {
  const v = { n: 8, slots: ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8'], focus: 2, stack: true };
  Stack.add(v, 'c9', () => 0);
  assert.strictEqual(v.n, 8);
  assert.ok(shown(v).includes('c9'));
  assert.ok(!shown(v).includes('c3'));
});

test('an empty pane in the stack is used before adding one', () => {
  const v = { n: 2, slots: ['b1', null, ...Array(6).fill(null)], focus: 0, stack: true };
  Stack.add(v, 'a1', rank);
  assert.strictEqual(v.n, 2);
  assert.deepStrictEqual(shown(v), ['a1', 'b1']);
});

test('sort puts a project above b before it, chats by their order, empty panes last', () => {
  const v = { n: 4, slots: ['b1', null, 'a2', 'a1', ...Array(4).fill(null)], focus: 0, stack: true };
  Stack.sort(v, rank);
  assert.deepStrictEqual(shown(v), ['a1', 'a2', 'b1', null]);
  assert.strictEqual(v.slots[v.focus], 'b1');
});

test('removing a chat from the middle closes the gap', () => {
  const v = { n: 3, slots: ['a1', 'a2', 'b1', ...Array(5).fill(null)], focus: 2, stack: true };
  Stack.removeFrom(v, 'a2');
  assert.strictEqual(v.n, 2);
  assert.deepStrictEqual(shown(v), ['a1', 'b1']);
  assert.strictEqual(v.slots[v.focus], 'b1');
  assert.strictEqual(v.slots.length, 8);
});

test('removing the last chat leaves one empty pane', () => {
  const v = { n: 1, slots: ['a1', ...Array(7).fill(null)], focus: 0, stack: true };
  Stack.removeFrom(v, 'a1');
  assert.strictEqual(v.n, 1);
  assert.deepStrictEqual(shown(v), [null]);
});

test('a chat that is gone ranks after every known one', () => {
  assert.ok(rank('gone') > rank('b1'));
});
