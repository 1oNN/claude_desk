require('./_env');
const test = require('node:test');
const assert = require('node:assert');
const { digest, clean } = require('../src/main/oneliner');

const j = o => JSON.stringify(o);
const user = text => j({ type: 'user', message: { content: text } });
const said = (...blocks) => j({ type: 'assistant', message: { content: blocks } });

test('digest leads with the newest typed ask and keeps tools and text in order', () => {
  const t = [
    user('fix the login page'),
    said({ type: 'text', text: 'Looking at it.' }),
    user('<command-name>/clear</command-name>'),
    user('now add a logout button'),
    said({ type: 'tool_use', name: 'Read', input: { file_path: 'src/app.js' } }),
    said({ type: 'tool_use', name: 'Bash', input: { command: 'npm test', description: 'Run the tests' } }),
    j({ type: 'user', isSidechain: true, message: { content: 'subagent chatter' } }),
    'not json',
  ].join('\n');
  const d = digest(t);
  assert.match(d, /^Last request from the person: now add a logout button/);
  assert.ok(d.indexOf('TOOL Read: src/app.js') < d.indexOf('TOOL Bash: Run the tests'));
  assert.ok(!d.includes('subagent chatter'));
  assert.ok(!d.includes('/clear'));
});

test('digest stays under its size cap on a long session', () => {
  const t = Array.from({ length: 200 }, (_, i) => said({ type: 'text', text: 'x'.repeat(500) + i })).join('\n');
  assert.ok(digest(t, 2500).length <= 2500);
});

test('clean keeps one plain line with no dashes or quotes', () => {
  assert.strictEqual(clean('"Fixing the login page."\nextra'), 'Fixing the login page');
  assert.strictEqual(clean('Tests \u2014 running'), 'Tests , running');
  assert.ok(clean('a '.repeat(100)).length <= 70);
});
