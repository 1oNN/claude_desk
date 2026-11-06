const env = require('./_env');
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Laptop, shq, int, knownHostKeys, pollScript } = require('../src/main/laptop');

// enough of POSIX sh word splitting to check what a command line means: quotes, backslashes, ; && |
function words(line) {
  const out = []; let cur = null, i = 0;
  const push = () => { if (cur !== null) out.push(cur); cur = null; };
  while (i < line.length) {
    const ch = line[i];
    if (ch === "'") { const j = line.indexOf("'", i + 1); cur = (cur || '') + line.slice(i + 1, j); i = j + 1; }
    else if (ch === '"') { let j = i + 1, s = ''; while (line[j] !== '"') { if (line[j] === '\\') j++; s += line[j++]; } cur = (cur || '') + s; i = j + 1; }
    else if (ch === '\\') { cur = (cur || '') + line[i + 1]; i += 2; }
    else if (/\s/.test(ch)) { push(); i++; }
    else if (ch === ';' || ch === '|' || ch === '&') { push(); let op = ch; if ((ch === '&' || ch === '|') && line[i + 1] === ch) op += ch; out.push({ op }); i += op.length; }
    else { cur = (cur || '') + ch; i++; }
  }
  push();
  return out;
}

const NASTY = "x'; rm -rf ~; echo \"$HOME\" `id` $(id)";

test('shq survives a shell round trip', () => {
  for (const s of ['plain', "it's", NASTY, '', "''", '\\']) assert.deepStrictEqual(words(shq(s)), [s]);
});

test('int only lets plain positive numbers through', () => {
  assert.strictEqual(int('42'), 42);
  assert.strictEqual(int('1; reboot', 7), 7);
  assert.strictEqual(int(-3, 9), 9);
  assert.strictEqual(int(1e9, 5), 5);
});

test('startCommand keeps every value one word, at both shell levels', () => {
  const s = { name: NASTY, tag: NASTY, cwd: '/home/u/' + NASTY, sid: NASTY, account: '2; reboot' };
  const cmd = Laptop.prototype.startCommand.call({}, s, { resume: false, cols: '80; reboot', rows: 24 });
  const w = words(cmd);
  const ops = w.filter(x => typeof x === 'object').map(x => x.op);
  assert.deepStrictEqual(ops, [';', '&&', '&&', '&&']);
  const i = w.indexOf('new-session');
  assert.deepStrictEqual(w.slice(i, i + 9), ['new-session', '-d', '-s', NASTY, '-x', '120', '-y', '24', '-c']);
  assert.strictEqual(w[i + 9], s.cwd);
  // the pane command is bash -lc '<inner>', and inner must split the same way
  const inner = words(w[i + 10]);
  assert.deepStrictEqual(inner.slice(0, 2), ['bash', '-lc']);
  const run = words(inner[2]);
  assert.ok(!run.some(x => typeof x === 'string' && /reboot/.test(x)), 'account was not coerced');
  const e = run.indexOf('exec');
  assert.deepStrictEqual(run.slice(e, e + 6), ['exec', 'claude', '-n', NASTY, '--session-id', NASTY]);
});

test('the poll script reads only Claude Code and Desk folders unless alliance is on', () => {
  const plain = pollScript(false), all = pollScript(true);
  assert.ok(!plain.includes('Claude/shared'));
  assert.ok(plain.includes('.claude-desk/accounts'));
  assert.notStrictEqual(plain, all);
});

test('knownHostKeys reads plain, hashed and revoked lines and skips CA lines', () => {
  const key = n => Buffer.from('key-' + n).toString('base64');
  const salt = crypto.randomBytes(20);
  const hash = crypto.createHmac('sha1', salt).update('[box.lan]:2222').digest('base64');
  const file = path.join(env.root, 'known_hosts');
  fs.writeFileSync(file, [
    `box.lan ssh-ed25519 ${key(1)}`,
    `|1|${salt.toString('base64')}|${hash} ssh-ed25519 ${key(2)}`,
    `@revoked [box.lan]:2222 ssh-rsa ${key(3)}`,
    `@cert-authority box.lan ssh-rsa ${key(4)}`,
    `other.lan ssh-ed25519 ${key(5)}`,
    '# comment',
  ].join('\n'));
  const r = knownHostKeys({ host: 'box.lan', port: 2222 }, file);
  assert.deepStrictEqual(r.keys.map(b => b.toString()), ['key-2']);
  assert.deepStrictEqual(r.revoked.map(b => b.toString()), ['key-3']);
  const r22 = knownHostKeys({ host: 'box.lan', port: 22 }, file);
  assert.deepStrictEqual(r22.keys.map(b => b.toString()), ['key-1']);
  assert.deepStrictEqual(r22.revoked, []);
});
