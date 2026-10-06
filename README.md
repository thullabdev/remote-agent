# Remote Agent

## 1. What it is

Watch and steer every active Claude Code Session on this machine from Telegram: receive Prompts (Questions and Permission Requests) and Reports, answer Prompts remotely, and send Instructions to idle Sessions so they continue. A local Bun Bridge talks to Telegram, and a Claude Code mod connects each Session to the Bridge.

- Glossary: [`CONTEXT.md`](CONTEXT.md)
- Decision: [ADR-0001](docs/adr/0001-mod-as-session-client.md)
- Research: [`references/`](references/README.md)

## 2. Telegram setup

1. In @BotFather: `/newbot`, then copy the token.
2. Create a private group, open its settings, enable **Topics** (this converts it to a supergroup).
3. Add the bot as an **admin** with **Manage Topics**. Admin bots receive every message, so privacy mode doesn't matter.
4. Turn off "Remain anonymous" for your own admin account. Anonymous posts arrive from the group, not from you, and the allowlist drops them.
5. Get the chat id: send a message in the group, then `curl "https://api.telegram.org/bot<TOKEN>/getUpdates"` and read `message.chat.id`. It is negative and starts with `-100`. Get your user id from `message.from.id` in the same output.

## 3. Run the Bridge

```bash
mkdir -p ~/.config/remote-agent && cp .env.example ~/.config/remote-agent/env && chmod 600 ~/.config/remote-agent/env
# edit the values, then:
mkdir -p ~/.config/systemd/user && cp deploy/remote-agent.service ~/.config/systemd/user/
systemctl --user daemon-reload && systemctl --user enable --now remote-agent
journalctl --user -u remote-agent -f
```

## 4. Install the mod

```bash
claude plugin marketplace add /home/giganotosaurus/Sites/remote-agent/mod
claude plugin install remote-agent@remote-agent-local --scope user
claude plugin list
```

Already-running sessions pick it up after `/reload-plugins`.

## 5. Using it

- Each Session gets its own Thread, titled `<project> · <first 8 chars of session id>`. It is created lazily on the first message for a Session, and closed (and forgotten) when the Session ends.
- Question: one message per question. Single-select questions get one button per option. Multi-select questions are answered by replying with numbers (`1,3`). Any reply text that is not option numbers is a free-text ("Other") Answer.
- Permission Request: Allow / Deny buttons. Replying `allow`/`yes` allows, `deny`/`no` denies, and any other reply denies with that text as feedback to the agent.
- On resolution, the buttons are removed and a note is posted as a reply (for example `✅ Allowed (local)`).
- Any other text in a Session's Thread is an Instruction. It is queued if the Session is busy and delivered when the Session is idle.
- Commands: `/away` turns Away mode on (Reports are pushed), `/back` turns it off, `/status` lists Sessions and pending Prompts.

## 6. Security notes

- The socket is user-only (0600).
- Only one chat and one user are accepted. Everything else is ignored.
- Text is redacted and truncated, but Telegram bot chats are **not** end-to-end encrypted.
- The mod runs with your permissions and never approves anything without an Answer.

## 7. Known limitations

- Headless (`-p`/SDK) sessions are not bridged.
- Behaviour of the terminal dialog when Telegram answers first: see `references/spike-results.md` (filled in after the mod spike).
