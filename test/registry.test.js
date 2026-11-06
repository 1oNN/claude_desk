require('./_env');
const test = require('node:test');
const assert = require('node:assert');
const reg = require('../src/main/registry');

test('desk names carry the account number, any number of digits', () => {
  assert.strictEqual(reg.accountFromName('jobs-1a'), 1);
  assert.strictEqual(reg.accountFromName('jobs-10a'), 10);
  assert.strictEqual(reg.accountFromName('my-app-123c'), 123);
  assert.strictEqual(reg.accountFromName('claude-4'), 4);
  assert.strictEqual(reg.accountFromName('nonsense'), 0);
});

test('isDeskName keeps plain claude-N sessions out', () => {
  assert.ok(reg.isDeskName('jobs-12b'));
  assert.ok(!reg.isDeskName('claude-3'));
  assert.ok(!reg.isDeskName('Jobs-1a'));
  assert.ok(!reg.isDeskName("x-1a'; rm -rf ~"));
});

test('allocateName takes the next free letter', () => {
  assert.strictEqual(reg.allocateName('jobs', 2, new Set()), 'jobs-2a');
  assert.strictEqual(reg.allocateName('jobs', 2, new Set(['jobs-2a', 'jobs-2b'])), 'jobs-2c');
  assert.strictEqual(reg.allocateName('jobs', 11, new Set(['jobs-1a'])), 'jobs-11a');
});

test('projectSlug is safe for a session name', () => {
  assert.strictEqual(reg.projectSlug('C:\\Work\\My App\\'), 'my-app');
  assert.strictEqual(reg.projectSlug('/home/x/__'), 'project');
});
