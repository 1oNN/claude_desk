const env = require('./_env');
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const C = require('../src/main/consts');

const set = o => { fs.writeFileSync(C.SETTINGS_FILE, JSON.stringify(o)); C.resolve(); };

test('state lives where DESK_STATE_DIR says', () => {
  assert.strictEqual(C.STATE_DIR, env.state);
});

test('defaults are off: no alliance, no remote, nothing in the prompt', () => {
  set({});
  assert.strictEqual(C.ALLIANCE, false);
  assert.strictEqual(C.REMOTE_HOST, null);
  assert.strictEqual(C.CONTEXT, 'off');
  assert.strictEqual(C.CARRY, false);
  assert.strictEqual(C.APP_NAME, 'Claude Desk');
});

test('an alliance root without its prompt script stays off', () => {
  set({ allianceRoot: env.root });
  assert.strictEqual(C.ALLIANCE, false);
});

test('remote host and folder must be plain names', () => {
  set({ remoteHost: 'box; rm -rf ~', remoteProjects: '../../etc' });
  assert.strictEqual(C.REMOTE_HOST, null);
  assert.strictEqual(C.REMOTE_PROJECTS, 'projects');
  set({ remoteHost: 'my-laptop', remoteProjects: '/code/work/' });
  assert.strictEqual(C.REMOTE_HOST, 'my-laptop');
  assert.strictEqual(C.REMOTE_PROJECTS, 'code/work');
});

test('context takes only known values', () => {
  set({ context: 'team', carryOn: true });
  assert.strictEqual(C.CONTEXT, 'team');
  assert.strictEqual(C.CARRY, true);
  set({ context: 'everything', carryOn: 'yes' });
  assert.strictEqual(C.CONTEXT, 'off');
  assert.strictEqual(C.CARRY, false);
});

test('a projects folder from settings is used when it exists', () => {
  const dir = path.join(env.root, 'projects');
  fs.mkdirSync(dir, { recursive: true });
  set({ projectsRoot: dir });
  assert.strictEqual(C.PROJECTS_ROOT, path.normalize(dir));
});
