const env = require('./_env');
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const accounts = require('../src/main/accounts');
const alliance = require('../src/main/alliance');

test('a fresh install has one account and is a first run', () => {
  accounts.load();
  assert.deepStrictEqual(accounts.ids(), [1]);
  assert.ok(accounts.isFirstRun());
  assert.strictEqual(accounts.configDir(1), process.env.CLAUDE_CONFIG_DIR);
  assert.ok(!fs.existsSync(accounts.FILE));
});

test('adding an account makes its own folder and writes the store', () => {
  const a = accounts.add({ name: 'Work', colour: '#112233', share: false });
  assert.strictEqual(a.id, 2);
  assert.strictEqual(a.configDir, path.join(env.state, 'accounts', '2'));
  assert.ok(fs.statSync(a.configDir).isDirectory());
  assert.ok(!accounts.isFirstRun());
  assert.strictEqual(JSON.parse(fs.readFileSync(accounts.FILE, 'utf8')).length, 2);
});

test('bad input is refused or cleaned', () => {
  assert.throws(() => accounts.add({ configDir: path.join(env.root, 'missing') }), /does not exist/);
  assert.throws(() => accounts.add({ configDir: 'relative/dir' }), /does not exist/);
  const a = accounts.update(2, { colour: 'red; background:url(x)', name: '\u0007Bell\n' });
  assert.strictEqual(a.colour, '#112233');
  assert.strictEqual(a.name, 'Bell');
});

test('the view never carries credentials', () => {
  const dir = accounts.configDir(2);
  fs.writeFileSync(path.join(dir, '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: 'secret' } }));
  fs.writeFileSync(path.join(dir, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'a@b.c' } }));
  const v = accounts.view().find(x => x.id === 2);
  assert.strictEqual(v.signedIn, true);
  assert.strictEqual(v.email, 'a@b.c');
  assert.ok(!JSON.stringify(accounts.view()).includes('secret'));
});

test('removing keeps the folder, and the last account cannot go', () => {
  const dir = accounts.configDir(2);
  accounts.remove(2);
  assert.ok(fs.existsSync(dir));
  assert.throws(() => accounts.remove(1), /at least one/);
});

test('a broken store falls back to the seed and drops junk rows', () => {
  fs.writeFileSync(accounts.FILE, JSON.stringify([{ id: 'x' }, { id: 3, name: 'Three', configDir: 'not/absolute' }, { id: 3 }, { id: 5000 }]));
  accounts.load();
  assert.deepStrictEqual(accounts.ids(), [3]);
  assert.strictEqual(accounts.get(3).configDir, null);
});

test('transcriptPath follows the account folder', () => {
  const p = alliance.transcriptPath(3, 'C:\\Work\\app', 'abc');
  assert.strictEqual(p, path.join(process.env.CLAUDE_CONFIG_DIR, 'projects', 'C--Work-app', 'abc.jsonl'));
});
