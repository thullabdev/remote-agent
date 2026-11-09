# Changelog

All notable changes to Remote Agent are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- **Installers.** `install.sh` sets up Linux and macOS: Bun, tmux, dependencies, the web UI build, the config file, the background service (systemd on Linux, launch agent on macOS) and the Claude Code mod. It is safe to re-run. `install.ps1` runs it inside WSL2 on Windows.
- **`remote-agent.sh`** runs the Bridge without systemd: `start [--bg]`, `restart`, `stop`, `status [--all]` and `logs`. The installer uses it on Linux when systemd is unavailable.
- **Session status.** `remote-agent.sh status` lists active sessions with their busy state, pending prompts, unread counts and attach commands. `--all` includes ended sessions.
- **Sessions without systemd.** Sessions started from chat run in plain tmux when `systemd-run` is missing, such as on macOS or Linux without systemd. They still outlive the Bridge.
- **File and image attachments.** Attach PNG, JPEG, GIF, WebP or PDF files from the composer, or pick them from a shared library with `@`. Each message takes up to five files; each file is at most 10 MB.
- **Message pins.** Pin your messages and agent replies, and list them in the chat details.
- **Diffs for edits.** Edit tool calls show as a diff with the changed characters highlighted.
- **Usage meters.** Context usage per session and account limits appear in the web UI, and the Bridge reports them in the state.
- **Day grouping.** Chat messages are grouped by day under sticky date labels.
- **Logo.** Light and dark SVG versions of the Remote Agent logo, used in the README.
- **License.** Released under the MIT License.

### Changed

- The README is rewritten as a full project guide: features, platform support, prerequisites, installation, configuration, running, troubleshooting, development, limitations and contributing.
- The web channel developer guide documents the attachment, pin and library endpoints, and the `usage` field in `GET /api/state`.
- The account usage strip is removed from the chat list.

### Fixed

- The installer reports a clear error when it cannot install tmux without `sudo`.
- The installer refuses an env file that still has placeholder values, and reports the Bridge's own configuration error.
- The web channel guide links to the README's Configuration section.
