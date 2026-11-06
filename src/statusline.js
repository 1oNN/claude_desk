// Claude Code runs this as the status line of a Desk session (through desk-status.cmd, with Electron acting as node).
// It keeps the usage numbers Claude Code hands it in <state>/status/<session id>.json and prints one short line.
const fs = require('fs');
const path = require('path');

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => { raw += d; if (raw.length > 1 << 20) process.exit(0); });
process.stdin.on('end', () => {
  let j;
  try { j = JSON.parse(raw); } catch { return; }
  const rl = j.rate_limits || {};
  const pct = w => w && typeof w.used_percentage === 'number' ? Math.round(w.used_percentage) : null;
  const reset = w => w && typeof w.resets_at === 'number' ? w.resets_at : null;
  const cost = j.cost && typeof j.cost.total_cost_usd === 'number' ? j.cost.total_cost_usd : 0;
  const sid = String(j.session_id || '').replace(/[^A-Za-z0-9-]/g, '').slice(0, 64);
  const now = { five_hour: pct(rl.five_hour), seven_day: pct(rl.seven_day), five_hour_reset: reset(rl.five_hour), seven_day_reset: reset(rl.seven_day) };
  if (sid) {
    const dir = path.join(__dirname, '..', 'status');
    const file = path.join(dir, sid + '.json');
    let prev = {};
    try { prev = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* first line of this session */ }
    // a resumed session starts counting from zero again
    let base = prev.base || 0;
    if (typeof prev.last === 'number' && cost < prev.last) base += prev.last;
    const rec = { account: Number(process.env.DESK_ACCOUNT) || 0, base, last: cost, t: Math.floor(Date.now() / 1000) };
    for (const k of Object.keys(now)) rec[k] = now[k] != null ? now[k] : (prev[k] != null ? prev[k] : null);
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file + '.tmp', JSON.stringify(rec));
      fs.renameSync(file + '.tmp', file);
    } catch { /* the line still prints */ }
  }
  const parts = [];
  if (j.model && j.model.display_name) parts.push(j.model.display_name);
  if (now.five_hour != null) parts.push(`5h ${now.five_hour}%`);
  if (now.seven_day != null) parts.push(`7d ${now.seven_day}%`);
  if (now.five_hour == null && cost) parts.push(`$${cost.toFixed(2)}`);
  if (j.context_window && typeof j.context_window.used_percentage === 'number') parts.push(`ctx ${Math.round(j.context_window.used_percentage)}%`);
  process.stdout.write(parts.join('  '));
});
