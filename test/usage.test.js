require('./_env');
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const usage = require('../src/main/usage');

// runs the real status line script the way Claude Code does: JSON on stdin
function line(input, account) {
  const dir = path.join(path.dirname(usage.STATUS), 'statusline');
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(path.join(__dirname, '..', 'src', 'statusline.js'), path.join(dir, 'statusline.js'));
  return execFileSync(process.execPath, [path.join(dir, 'statusline.js')], { input: JSON.stringify(input), env: { ...process.env, DESK_ACCOUNT: String(account) } }).toString();
}

test('the status line keeps context and model per session, and read hands them back by session id', () => {
  const out = line({ session_id: 'aaaa-1', model: { display_name: 'Opus 5.5' }, context_window: { used_percentage: 41.6 }, rate_limits: { five_hour: { used_percentage: 12, resets_at: 2000000000 }, seven_day: { used_percentage: 30 } } }, 2);
  assert.match(out, /ctx 42%/);
  // a later line without context keeps the last one seen
  line({ session_id: 'aaaa-1', model: { display_name: 'Opus 5.5' }, rate_limits: { five_hour: { used_percentage: 14 } } }, 2);
  const bySid = {};
  const v = usage.read(bySid);
  assert.strictEqual(v[2].five_hour, 14);
  assert.strictEqual(v[2].seven_day, 30);
  assert.strictEqual(bySid['aaaa-1'].ctx, 42);
  assert.strictEqual(bySid['aaaa-1'].model, 'Opus 5.5');
  assert.ok(bySid['aaaa-1'].t > 0);
});
