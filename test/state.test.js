const env = require('./_env');
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const S = require('../src/main/state');

test('a 0.1 desk.json moves its layout into window 1 and keeps the preferences', () => {
  fs.writeFileSync(S.FILE, JSON.stringify({ sessions: [], ui: { theme: 'light', current: 'pc:F:\a', views: { 'pc:F:\a': { n: 2, slots: ['x', 'y'] } }, nav: 'projects', sidebar: { w: 280 }, termFont: 15 } }));
  const s = S.load();
  assert.deepStrictEqual(Object.keys(s.ui).sort(), ['termFont', 'theme']);
  assert.strictEqual(s.windows.length, 1);
  assert.strictEqual(s.windows[0].wid, 1);
  assert.strictEqual(s.windows[0].current, 'pc:F:\a');
  assert.deepStrictEqual(s.windows[0].views['pc:F:\a'].slots, ['x', 'y']);
  assert.strictEqual(s.windows[0].sidebar.w, 280);
});

test('an empty state still gets one window', () => {
  try { fs.unlinkSync(S.FILE); } catch { /* none */ }
  const s = S.load();
  assert.strictEqual(s.windows.length, 1);
  assert.deepStrictEqual(s.windows[0].views, {});
});

test('saved windows are renumbered from 1 in order', () => {
  const s = S.migrate({ ui: {}, windows: [{ wid: 4, current: 'a' }, { wid: 9, current: 'b' }] });
  assert.deepStrictEqual(s.windows.map(w => [w.wid, w.current]), [[1, 'a'], [2, 'b']]);
});

test('a window saving its ui splits layout from preferences', () => {
  const s = S.migrate({ ui: { theme: 'dark' }, windows: [{ wid: 1, current: 'a' }, { wid: 2, current: 'b' }] });
  const changed = S.mergeUi(s, 2, { theme: 'dark', current: 'c', views: { c: { n: 1 } } });
  assert.strictEqual(changed, false);
  assert.strictEqual(s.windows[0].current, 'a');
  assert.strictEqual(s.windows[1].current, 'c');
  assert.strictEqual(s.ui.current, undefined);
  assert.strictEqual(S.mergeUi(s, 1, { theme: 'light', current: 'a' }), true);
  assert.strictEqual(s.ui.theme, 'light');
});

test('each window starts from the shared preferences and its own layout', () => {
  const s = S.migrate({ ui: { theme: 'light' }, windows: [{ wid: 1, current: 'a' }, { wid: 2, current: 'b', nav: 'home' }] });
  assert.deepStrictEqual(S.uiFor(s, 2), { theme: 'light', current: 'b', nav: 'home', views: {} });
  assert.strictEqual(S.uiFor(s, 1).current, 'a');
});

test('the save carries the windows', async () => {
  const s = S.migrate({ ui: {}, sessions: [], extraProjects: [], windows: [{ wid: 1, current: 'a', bounds: { x: 1, y: 2, width: 900, height: 600 } }] });
  S.saveNow(s);
  const back = JSON.parse(fs.readFileSync(S.FILE, 'utf8'));
  assert.strictEqual(back.windows[0].bounds.width, 900);
});

test('a new project name is one plain folder that does not exist yet', () => {
  const root = path.join(env.root, 'projects');
  fs.mkdirSync(path.join(root, 'taken'), { recursive: true });
  assert.strictEqual(S.checkProjectName('my-app', root), null);
  for (const bad of ['', '  ', '..', '..\\x', 'a/b', 'con', 'COM1', 'nul.txt', 'x.', 'a:b', 'taken']) assert.ok(S.checkProjectName(bad, root), bad);
  assert.match(S.checkProjectName('ok', null), /projects folder/);
});
