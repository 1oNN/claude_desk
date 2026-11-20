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

test('a parked turn reads its background job, not the frozen interactive entry', () => {
  const ui = { pid: 1, kind: 'interactive', status: 'busy', parkedJobId: 'c0ea5213', sessionId: 'old' };
  const job = { pid: 2, kind: 'bg', status: 'idle', jobId: 'c0ea5213', sessionId: 'new' };
  assert.strictEqual(reg.parkedJob(ui, [ui, job]), job);
  assert.strictEqual(reg.liveStatus(ui, [ui, job]), 'idle');
  assert.strictEqual(reg.liveStatus(ui, [ui, { ...job, status: 'busy' }]), 'busy');
  assert.strictEqual(reg.liveStatus(ui, [ui]), 'idle', 'the job has exited');
  assert.strictEqual(reg.liveStatus({ pid: 3, status: 'waiting' }, []), 'waiting');
  assert.strictEqual(reg.liveStatus(null, []), null);
});

test('the registry outranks a stale tag', () => {
  const s = (t, r, d) => [reg.deskState(t, r, d), reg.glyphFor(t, r, d)].join(' ');
  assert.strictEqual(s('running', 'idle', false), 'finished done', 'running tag after the shells ended');
  assert.strictEqual(s('running', 'shell', false), 'working running', 'shells still out');
  assert.strictEqual(s('done', 'shell', true), 'working running');
  assert.strictEqual(s('working', 'idle', false), 'idle idle', 'Esc leaves the tag at working');
  assert.strictEqual(s('done', 'busy', true), 'working spin');
  assert.strictEqual(s(null, 'waiting', false), 'waiting asking');
  assert.strictEqual(s('failed', 'idle', false), 'finished failed');
  assert.strictEqual(s(null, 'idle', true), 'finished done');
  assert.strictEqual(s(null, 'idle', false), 'idle idle');
});

test('with no registry entry the tag decides', () => {
  const s = (t, d) => [reg.deskState(t, null, d), reg.glyphFor(t, null, d)].join(' ');
  assert.strictEqual(s('working', false), 'working spin');
  assert.strictEqual(s('running', false), 'working running');
  assert.strictEqual(s('asking', false), 'waiting asking');
  assert.strictEqual(s('done', false), 'finished done');
  assert.strictEqual(s(null, false), 'idle idle');
});
