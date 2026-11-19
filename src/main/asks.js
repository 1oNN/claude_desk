// The newest request typed into a session, read from the tail of its transcript. No model call, so no tokens.
const fs = require('fs');

const TAIL = 64 * 1024;
const BIG = 1024 * 1024;
const MAX = 90;
const cache = new Map(); // transcript path -> { size, line }

// a prompt with a picture in it arrives as blocks; tool results are user records too and never count
function typed(c) {
  if (typeof c === 'string') return c;
  if (!Array.isArray(c) || c.some(b => b && b.type === 'tool_result')) return '';
  return c.filter(b => b && b.type === 'text').map(b => b.text || '').join(' ');
}

function lastAsk(text) {
  const lines = String(text || '').split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!/"type": ?"user"/.test(lines[i])) continue;
    let r; try { r = JSON.parse(lines[i]); } catch { continue; }
    if (r.type !== 'user' || r.isSidechain || r.isMeta || r.isCompactSummary) continue;
    const t = typed(r.message && r.message.content).replace(/\s+/g, ' ').trim();
    // slash commands and their output come wrapped in tags; an Esc leaves a [Request interrupted ...] record
    if (!t || t.startsWith('<') || t.startsWith('[Request interrupted')) continue;
    return t.length > MAX ? t.slice(0, MAX - 3) + '...' : t;
  }
  return null;
}

function readTail(file, size, n) {
  n = Math.min(size, n);
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(n); fs.readSync(fd, buf, 0, n, size - n);
    const t = buf.toString('utf8');
    return n < size ? t.slice(t.indexOf('\n') + 1) : t;
  } finally { fs.closeSync(fd); }
}

// read again only when the transcript grew; a long run of tool output can push the ask out of the tail, so keep the last one found
function line(file) {
  let size; try { size = fs.statSync(file).size; } catch { return null; }
  const c = cache.get(file);
  if (c && c.size === size) return c.line;
  let found = null;
  try {
    found = lastAsk(readTail(file, size, TAIL));
    if (!found && size > TAIL && !c) found = lastAsk(readTail(file, size, BIG));
  } catch { /* locked or gone, try on the next poll */ }
  const v = found || (c && c.line) || null;
  cache.set(file, { size, line: v });
  return v;
}

function forget(file) { cache.delete(file); }

module.exports = { line, lastAsk, forget };
