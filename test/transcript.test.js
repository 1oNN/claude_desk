const env = require('./_env');
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const alliance = require('../src/main/alliance');

const sid = '0f3c2a9e-1111-4c4c-8888-123456789abc';
const cwd = path.join(env.root, 'proj');
function seed() {
  const file = alliance.transcriptPath(0, cwd, sid), dir = file.slice(0, -6);
  fs.mkdirSync(path.join(dir, 'subagents'), { recursive: true });
  fs.writeFileSync(file, '{"type":"user"}\n');
  fs.writeFileSync(path.join(dir, 'subagents', 'a.jsonl'), '{}\n');
  return { file, dir };
}

test('deleteTranscript removes the transcript and the folder beside it, nothing else', () => {
  const { file, dir } = seed();
  const other = path.join(path.dirname(file), 'other.jsonl'); fs.writeFileSync(other, '{}\n');
  const r = alliance.deleteTranscript(0, cwd, sid);
  assert.strictEqual(r.error, undefined);
  assert.deepStrictEqual(r.removed, [file, dir]);
  assert.ok(!fs.existsSync(file) && !fs.existsSync(dir));
  assert.ok(fs.existsSync(other));
});

test('a link inside the folder stops the folder delete, and its target survives', () => {
  const { file, dir } = seed();
  const outside = path.join(env.root, 'keep'); fs.mkdirSync(outside, { recursive: true }); fs.writeFileSync(path.join(outside, 'x'), 'x');
  fs.symlinkSync(outside, path.join(dir, 'subagents', 'j'), 'junction');
  const r = alliance.deleteTranscript(0, cwd, sid);
  assert.match(r.error, /link/);
  assert.deepStrictEqual(r.removed, [file]);
  assert.ok(fs.existsSync(dir) && fs.existsSync(path.join(outside, 'x')));
});

test('a missing or odd session id deletes nothing', () => {
  assert.deepStrictEqual(alliance.deleteTranscript(0, cwd, '../..').removed, []);
  assert.deepStrictEqual(alliance.deleteTranscript(0, cwd, '').removed, []);
});
