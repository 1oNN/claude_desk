const env = require('./_env');
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const asks = require('../src/main/asks');
const { turnDone } = require('../src/main/registry');

const j = o => JSON.stringify(o);
const user = content => j({ type: 'user', message: { content } });
const said = text => j({ type: 'assistant', message: { content: [{ type: 'text', text }] } });

test('the newest typed request wins, commands and tool results do not count', () => {
  const t = [
    user('fix the login page'),
    said('Done.'),
    user('now add a logout button'),
    user([{ type: 'tool_result', tool_use_id: 'x', content: 'ok' }]),
    user('<command-name>/clear</command-name>'),
    user('[Request interrupted by user]'),
    j({ type: 'user', isSidechain: true, message: { content: 'subagent chatter' } }),
    j({ type: 'user', isMeta: true, message: { content: 'Caveat: meta' } }),
    'not json',
  ].join('\n');
  assert.strictEqual(asks.lastAsk(t), 'now add a logout button');
});

test('a prompt sent with a picture is read from its text blocks', () => {
  const t = user([{ type: 'image', source: {} }, { type: 'text', text: 'why is   this\nred' }]);
  assert.strictEqual(asks.lastAsk(t), 'why is this red');
});

test('a long request is clipped to 90 characters', () => {
  const got = asks.lastAsk(user('a'.repeat(200)));
  assert.strictEqual(got.length, 90);
  assert.ok(got.endsWith('...'));
});

test('line keeps the last ask when tool output pushes it out of the tail', () => {
  const file = path.join(env.root, 'asks.jsonl');
  fs.writeFileSync(file, user('migrate the database') + '\n');
  assert.strictEqual(asks.line(file), 'migrate the database');
  fs.appendFileSync(file, (said('x'.repeat(2000)) + '\n').repeat(100));
  assert.strictEqual(asks.line(file), 'migrate the database');
  fs.appendFileSync(file, user('now the seed data') + '\n');
  assert.strictEqual(asks.line(file), 'now the seed data');
  assert.strictEqual(asks.line(path.join(env.root, 'missing.jsonl')), null);
});

test('a turn is finished from busy to idle and until the next one starts', () => {
  assert.strictEqual(turnDone(null, 'idle', false), false, 'a fresh idle session is not finished');
  assert.strictEqual(turnDone('busy', 'idle', false), true);
  assert.strictEqual(turnDone('idle', 'idle', true), true, 'stays finished while idle');
  assert.strictEqual(turnDone('idle', undefined, true), true, 'a missed reading changes nothing');
  assert.strictEqual(turnDone('idle', 'busy', true), false);
  assert.strictEqual(turnDone('busy', 'waiting', false), false, 'asking is not finished');
  assert.strictEqual(turnDone('waiting', 'idle', false), false, 'Esc on a question is not a finished turn');
  assert.strictEqual(turnDone('busy', 'shell', false), false, 'background shells still out');
  assert.strictEqual(turnDone('shell', 'idle', false), true, 'the last shell ended');
  assert.strictEqual(turnDone('idle', 'shell', true), false);
});
