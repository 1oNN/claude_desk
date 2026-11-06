// every test file gets its own empty state and config folders before any Desk module loads
const fs = require('fs');
const os = require('os');
const path = require('path');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'desk-test-'));
process.env.DESK_STATE_DIR = path.join(root, 'state');
process.env.CLAUDE_CONFIG_DIR = path.join(root, 'claude');
fs.mkdirSync(process.env.DESK_STATE_DIR, { recursive: true });
fs.mkdirSync(process.env.CLAUDE_CONFIG_DIR, { recursive: true });
for (const k of ['DESK_ALLIANCE_ROOT', 'DESK_CLAUDE', 'DESK_PWSH', 'DESK_PROJECTS']) delete process.env[k];
module.exports = { root, state: process.env.DESK_STATE_DIR };
