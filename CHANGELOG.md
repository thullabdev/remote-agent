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
- **Mission control.** General opens as a dashboard: Sessions that need you, with Allow and Deny on the card; what is working now and its running tool; budget; projects; today's activity; recent events; and quick actions to start a project or resume the last Session. A Dashboard and Chat switch in the header reaches the command chat. `GET /api/activity` serves its numbers.
- **A redesigned Session list.** It opens on All and orders Sessions by need: waiting on you, pinned, unsent draft, working, then the rest. Needs you and Working tabs appear only while they hold something, Ended and Archived are tabs of their own, and a filter narrows to Computer or Spawned Sessions. Search covers title, project, folder, last message and draft. Tapping a Session that needs you, or its push notification, opens it at the Prompt.
- **Pinned Sessions, renaming and archiving.** Pin up to five live Sessions, rename any Session from its header, and archive ended Sessions one at a time or in bulk. New routes: `POST /api/chats/:id/pin`, `rename`, `archive`, `unarchive`, and `POST /api/chats/archive`.
- **Drafts that follow you.** The unsent message in a Chat is saved with its attachments and shows on your other devices (`GET` and `PUT /api/chats/:id/draft`).
- **A library dialog for uploads.** The attach picker searches the library and lets you tap several files to attach or detach them. A Library dialog lists every file with how many messages use it, and adds or deletes files.
- **Resume in place.** `/new --resume` resumes an ended Session in the same Chat and tmux session, with the model it last ran on or one you choose (`POST /api/chats/:id/resume`, `GET /api/chats/:id/resume-model`).
- **Usage details on demand.** Open the usage overlay from the context percent in the chat header.
- **Code block setting.** Choose whether long lines in code blocks wrap or scroll.
- **Logo.** Light and dark SVG versions of the Remote Agent logo, used in the README.
- **License.** Released under the MIT License.

### Changed

- The README is rewritten as a full project guide: features, platform support, prerequisites, installation, configuration, running, troubleshooting, development, limitations and contributing.
- The web channel developer guide documents the attachment, pin and library endpoints, and the `usage` field in `GET /api/state`.
- The README's "How it works" diagram is now an SVG in the logo's colors, with light and dark versions.
- The account usage strip is removed from the chat list, and the composer's usage pill is gone. Usage opens from the chat header.
- Chat titles read `<project> · <name>` without the Session id hash. A Session started from chat is named from its first task, and until named it reads "New session".
- General takes no attachments, and its composer hides the attach button.
- Deleting uploads moved from the picker to the Library dialog.
- The web UI detects a dead connection, reconnects when you return to it, and keeps list times moving.
- Toasts appear as a quiet card at the top on phones.

### Fixed

- The installer reports a clear error when it cannot install tmux without `sudo`.
- The installer refuses an env file that still has placeholder values, and reports the Bridge's own configuration error.
- The web channel guide links to the README's Configuration section.
- A Session's transcript and its resume use the folder the Session was launched in.
- Old transcript entries that the Chat never recorded are no longer backfilled.
- Text copies even where the async clipboard is unavailable, such as over plain http.
