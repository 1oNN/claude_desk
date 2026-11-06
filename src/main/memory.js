// Working set per session: one CIM call lists every process with its parent, then each session's tree is summed by pid.
const { execFile } = require('child_process');
const C = require('./consts');

let last = { at: 0, rows: [] };
let running = null;

function sample() {
  if (running) return running;
  if (!C.PWSH) return Promise.resolve(last);
  const cmd = 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,WorkingSetSize | ConvertTo-Json -Compress';
  running = new Promise(resolve => {
    execFile(C.PWSH, ['-NoProfile', '-NonInteractive', '-Command', cmd], { windowsHide: true, timeout: 30000, maxBuffer: 16 << 20 }, (err, so) => {
      running = null;
      if (err) return resolve(last);
      try {
        const rows = JSON.parse(so).map(r => ({ pid: r.ProcessId, ppid: r.ParentProcessId, ws: r.WorkingSetSize || 0 }));
        last = { at: Date.now(), rows };
      } catch { /* keep the previous sample */ }
      resolve(last);
    });
  });
  return running;
}

function treeBytes(rows, rootPid) {
  const kids = new Map();
  const byPid = new Map();
  for (const r of rows) { byPid.set(r.pid, r); if (!kids.has(r.ppid)) kids.set(r.ppid, []); kids.get(r.ppid).push(r.pid); }
  if (!byPid.has(rootPid)) return 0;
  let total = 0;
  const seen = new Set();
  const stack = [rootPid];
  while (stack.length) {
    const p = stack.pop();
    if (seen.has(p)) continue;
    seen.add(p);
    total += byPid.get(p).ws;
    for (const k of kids.get(p) || []) if (byPid.has(k)) stack.push(k);
  }
  return total;
}

module.exports = { sample, treeBytes, lastSample: () => last };
