# Antigravity Usage (agy) for BB

Adds Antigravity quota windows to BB's **Provider Usage** panel. It asks the
local `agy` CLI for usage and does not read OAuth token files or the OS
keyring.

## What it shows

- 5-hour limits
- weekly limits
- per-model windows such as `Gemini 4 Argon`
- reset timestamps and used percentages

Labels follow BB's short usage style:

- `5h - Gemini`
- `7d - Gemini`
- `7d - Argon`
- `5h - Claude & GPT`
- `7d - Claude & GPT`

The plugin maps `agy --print /usage` output into BB's native usage resources
for the `acp-antigravity` provider. The card appears in the Usage menu next to
Codex, Cursor, OpenCode, etc.

## Requirements

- BB 0.43 or newer.
- The Antigravity provider for BB:
  `bb plugin install antigravity`
- The Antigravity CLI `agy` on the same machine as the BB host:
  - Linux/macOS: `agy`
  - Windows: `agy.exe`
- A signed-in `agy` session. The ACP provider uses the same login. If `agy`
  is signed out, ACP threads will not run until you sign in again.

If `agy` is not on `PATH`, set the plugin setting **agy executable** to its
absolute path, or set `ANTIGRAVITY_AGY_PATH` in the host environment.

## Install

From GitHub:

```bash
bb plugin install git:https://github.com/ChezRD/bb-agy-usage.git
```

From a local checkout:

```bash
bb plugin install /path/to/bb-agy-usage
```

After installing, open BB's Usage menu and refresh. The plugin adds an
Antigravity source for every connected BB host.

## Authorization behaviour

When the session is missing or expired, `agy --print /usage` prints:

```text
Authentication required. Please visit the URL to log in:
Waiting for authentication (timeout 60s)...
authentication failed or timed out
```

The plugin detects that and shows an English message in the usage card:

> Sign in to Antigravity in agy on this machine, then reload.

The same `agy` login is used by `antigravity-acp`; there is no separate
Antigravity usage account. If the `agy` session expired, the card says:

> Your Antigravity session in agy expired. Sign in again, then reload.

## Privacy

The plugin does not read, print, or persist access tokens, refresh tokens, or
API keys. It only runs the local `agy` command and parses its usage output.
Prompt text and conversation content are never read.

## Cross-platform behaviour

- Linux: `agy` from `PATH`, then `~/.local/bin/agy`, `/usr/local/bin/agy`,
  `/usr/bin/agy`.
- macOS: `agy` from `PATH`, then `~/.local/bin/agy`, `/usr/local/bin/agy`,
  `/opt/homebrew/bin/agy`.
- Windows: `agy.exe` from `PATH`, then `%USERPROFILE%\.local\bin\agy.exe`.
  Commands run with `windowsHide: true`.

The implementation uses Node's `execFile` and has no OS-specific shell
dependencies. It has been exercised on Linux. The CI workflow runs the parser
and mapping tests on Linux, macOS, and Windows.

## Development

```bash
npm install
npm run typecheck
npm test
npm run probe   # prints the parsed agy usage for the local machine
```

`npm run probe` is safe to run without printing credentials: it only prints
the parsed windows.

## Notes

- The plugin is a usage source, not a change to BB's built-in provider
  capability flag. It does not set `maintenance.usage: true` on
  `acp-antigravity`; the card is supplied by this plugin.
- `agy` may wait for authentication when signed out. The plugin uses a
  15-second command timeout and returns `unauthenticated`; it does not hang the
  Usage panel.
