# Superpowers skills (vendored)

Copied from https://github.com/obra/superpowers at commit
`2ce8aa15d05bd57213e6f746f953aafb7ded7a8b` (v7.0.1). MIT licensed — see
`SUPERPOWERS-LICENSE`.

## Removed / changed

- `diagnosing-superpowers` — not included. It reads local session transcripts,
  bundles them, and files issues on the upstream GitHub repository.
- `brainstorming/scripts/server.cjs` — removed the remote logo image loaded from
  `primeradiant.com` (with the version in the query string; on by default
  unless a telemetry opt-out variable was set) and the link to the upstream
  repo. The header is now plain text and the version is pinned.
- `writing-skills/references/anthropic-best-practices.md` — removed three
  remote `<img>` embeds (mintcdn.com). Text links to documentation remain.
- Plugin manifests, session-start hooks, tests and per-harness installers from
  the upstream repo are not included; only the `skills/` contents.

All remaining scripts operate on local files only. The brainstorming companion
server binds to `127.0.0.1` by default and is protected by a per-session key.
