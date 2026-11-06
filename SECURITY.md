# Security policy

Please report vulnerabilities privately through GitHub private vulnerability
reporting on 1oNN/claude_desk (Security tab, "Report a vulnerability"). Do not
open a public issue for a security problem.

In scope: the Claude Desk Electron app in this repository (main process,
renderer, preload, installer and auto-update config).

Desk runs the real `claude` CLI in terminals. It never reads or stores Claude
tokens or credentials; login stays with the CLI. If you find a path where Desk
touches them, that is a valid report.

Out of scope: vulnerabilities in the Claude CLI itself, Electron, or other
upstream dependencies (report those upstream).
