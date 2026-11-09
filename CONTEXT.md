# Remote Agent

Lets a single user watch and steer their active Claude Code sessions from a web chat (or a messaging app), answering the agent's questions and permission requests remotely so the session continues.

## Language

**Session**:
One Claude Code conversation on the user's machine, identified by its Claude `session_id`.
_Avoid_: agent, run, instance

**Spawned Session**:
A Session the Bridge started on the user's request from the Channel, running in a detached tmux session the user can attach to. Only Spawned Sessions can be ended from the Channel. Any other Session was started by the user on their computer; the web chat labels those "Computer" and offers a Computer / Spawned source filter.
_Avoid_: remote session, bot session, laptop session

**Trusted folder**:
An existing directory listed in `REMOTE_AGENT_PROJECTS` or as a project key in Claude Code's `~/.claude.json`. Matched exactly, so subfolders are not allowed. The only places a Spawned Session may start.

**Prompt**:
Anything a Session is blocked on that needs a human decision. Either a Question or a Permission Request.
_Avoid_: ask, request (unqualified)

**Question**:
A Prompt where the agent asks the user to choose among options or give free text (e.g. AskUserQuestion).

**Permission Request**:
A Prompt where the agent needs allow/deny before running a tool.
_Avoid_: approval, confirmation

**Answer**:
The user's resolution of a Prompt — an option/free text for a Question, allow/deny for a Permission Request. The first Answer wins, whether given locally or remotely.

**Report**:
A one-way notification about a Session that needs no Answer (turn finished, session started/ended).
_Avoid_: alert, ping

**Instruction**:
Free text the user sends remotely to an idle Session to make it continue working.
_Avoid_: command, message

**Bridge**:
The long-running local process that connects Sessions to the Channel and holds pending Prompts.
_Avoid_: server, daemon, bot

**Channel**:
The place the user is reached through: the web chat first; Telegram kept switchable (`REMOTE_AGENT_CHANNELS`).
_Avoid_: provider, platform

**Chat**:
The web Channel's place for one Session, or for General (commands and the `/new` picker). Created when the Bridge first hears of the Session, marked ended when it ends, and its history stays readable.
_Avoid_: thread (in the web Channel), room, conversation

**Thread**:
The Telegram form of a **Chat**: a forum topic dedicated to one Session, created on the Session's first message and closed when the Session ends.
_Avoid_: topic, room, conversation

**Away mode**:
User-toggled state deciding whether Reports are pushed to the Channel. Prompts are always pushed. On when the Bridge starts. In the web Channel it gates Web Push of Reports in the same way.

## Relationships

- A **Session** raises zero or more **Prompts**; each **Prompt** gets at most one **Answer**
- A **Session** emits **Reports**; only an idle **Session** accepts an **Instruction**
- The **Bridge** serves exactly one user over one **Channel** (web by default; Telegram when selected)
- Each **Session** has at most one **Thread** (Telegram) or one **Chat** (web)
- In a **Thread**, a reply to a **Prompt** message is an **Answer**; any other text is an **Instruction**
- An **Instruction** sent while the **Session** is busy is queued and delivered when it becomes idle
- An unanswered **Prompt** waits indefinitely; the user gets one reminder after 30 minutes

## Example dialogue

> **Dev:** "If a **Permission Request** is answered in the terminal, what does Telegram show?"
> **Domain expert:** "The **Prompt** is already resolved — first **Answer** wins — so the Telegram message is edited to 'answered locally'."

## Flagged ambiguities

- "agent asks me" was used for both Questions and Permission Requests — resolved: both are **Prompts**.
