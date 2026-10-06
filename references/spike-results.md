# Mod spike results

Run on 2026-10-06 with Claude Code v2.1.291 (Haiku 4.5) on Linux. The spike mod (plan Task 1) was driven through a pty, with the spike server on its own socket. The evidence is the `MOD:` lines the mod posted to the server, together with the rendered terminal screen.

| ID | Expected | Observed | Consequence |
|---|---|---|---|
| E1a | The mod loads at session start | `E1 loaded session=0037b42b-… interactive=true`. `clock.every` polled `/instruction` every 3 s | ✅ No change |
| E1b | The mod reaches an already-running session | `/reload-plugins` in the running session re-ran `register` and `session.start` with the same session id, and the edited hooks took effect. Only tested with `--plugin-dir`, not via `CLAUDE_CODE_PLUGIN_DIRS` | ✅ README: already-running sessions need `/reload-plugins` once |
| E2/E3a | The remote answer wins and Claude receives it | The remote side won at 15013 ms (`signalAborted=false`). **But `next({ ...e, answers })` does not deliver answers.** First, `tool.check` then ran on the real call with `decision=ask`, and the native dialog opened. Second, when `tool.check` was forced to `allow` (E10), the tool returned `"answers":{}` and `text: "The user did not answer the questions."` (E11) | ❗ Task 13 must answer AskUserQuestion by **returning `{ result: { questions, answers } }` from the `tool.call` hook without calling `next`** (E12) |
| E12 | (added) The hook answers the call itself | `return { result: { questions: e.questions, answers: { [q]: 'Blue' } } }` → the transcript showed `User answered Claude's questions: … → Blue`, and Claude replied "Blue." No `tool.check` ran on the real call and no native dialog appeared | ✅ This is the delivery mechanism for both remote and local answers |
| E3a dialog | What happens to the local dialog after the remote side wins | The `$.ui.ask` dialog (header "Plugin") **stays on screen** after the turn finishes. Pressing **Esc closes it harmlessly**: its `$.ui.ask` rejects (`no answer (The user doesn't want to proceed…)`) and the turn is **not** interrupted. Any dialog raised later queues behind it until then | ⚠️ Known limitation: after answering remotely, press Esc in the terminal to clear the stale dialog |
| E3b | The local answer wins | `winner=local label=Red after=6501ms`. Claude received "Red" | ✅ |
| E4 | A remote allow or deny resolves a permission | Allow: `spike-allowed.txt` was created after about 15 s. Deny: `Permission to use Bash denied by plugins …: spike: remote said deny`, and Claude reported it. **No native permission dialog is shown while `tool.check` waits**, only the spinner | ✅ Task 13's own `$.ui.ask` Allow/Deny dialog is required for the local side |
| E5 idle | An Instruction starts a turn | `$.prompt.submit({ text, asUser: true })` started a new turn, shown as `› Prompt from the <plugin> plugin` followed by the text, and Claude answered it | ✅ (the label names the plugin) |
| E5 busy | An Instruction is held until idle | Submitted during a 22 s turn, it ran as its own turn right after that turn finished | ✅ |
| E6 | `tool_use_id` is present | `tool.call`: `toolu_01FGHK…`. `tool.check`: `toolu_018QeG…`. A plugin-raised `$.ui.ask` has the id `toolu_plugin_…` | ✅ No change |
| E7 | Does awaiting a `$.clock.after` promise count against the 10 s budget? | **Yes.** `tool.call hook skipped: ran past its 10s budget`, and the Read ran without the hook. Awaiting `$.http.fetch` and `$.ui.ask` for 15 s did **not** trip the budget (E2–E4) | Keep `sleepPort = $.clock.sleep` with `maxFailures: 3` (≈3 s of budget) |
| E9 | Does `tool.check` fire for AskUserQuestion? | Yes, with `decision=ask`. That includes the mod's own `$.ui.ask` call (`toolu_plugin_…`) | ✅ Keep the `e.tool === 'AskUserQuestion'` guard in Task 13's `tool.check`; without it the mod would forward its own dialog as a Permission Request |

## Decisions for Task 13

1. **AskUserQuestion delivery:** once `resolvePrompt` returns a question Answer, return `{ result: { questions: e.questions, answers: answer.answers } }`. Do not call `next`. Fall back to `next(e)` only when the Bridge is unreachable (`null`).
2. **Keep the `tool.check` guard** for AskUserQuestion.
3. **`sleepPort` stays on `$.clock.sleep`** with the default `maxFailures: 3`.
4. **Known limitations (README):** a stale terminal dialog stays after a remote Answer and is cleared with Esc. A delivered Instruction is labelled "Prompt from the remote-agent plugin". Sessions that are already running need `/reload-plugins` once.

## Round 2: permission modes (2026-10-06, Claude Code 2.1.291)

Trigger: in **auto mode** the mod (round 1 design) interrupted the user with its own "Plugin" Allow/Deny dialog and a Telegram prompt, where Claude Code would have let the classifier decide. Same pty-driven method as round 1; the spike mod and hook scripts live in the session scratchpad.

| ID | Question | Observed | Consequence |
|---|---|---|---|
| R1 | Does `tool.check` tell the modes apart? | **No.** `tool.check` returns `decision=ask` for a harmless `touch` in default mode **and** in auto mode (Sonnet 5.5, footer "auto mode on"). `ask` means "put it to the mode's decider": the user in default mode, the classifier in auto mode | The round-1 `tool.check` takeover is wrong for any mode whose decider is not the human |
| R2 | Do mod `classic.*` hooks fire? | **No**, in this build. `classic.PermissionRequest`, `classic.PreToolUse` and `classic.UserPromptSubmit` registered (validate lists them, the reload line names them) but never ran, though settings-file hooks for the same events did run in the same session. The types doc says they fire "whether or not any settings hook is configured" | Do not build on `classic.*`; use command hooks |
| R3 | When does a **command** `PermissionRequest` hook fire? | Only when Claude Code is about to show a permission dialog. Default mode: fires. **Auto mode, classifier approves: does not fire** (command ran, no hook, no dialog) | Mode-correct for free |
| R4 | Does the native dialog wait for the hook? | **No, they run concurrently.** At 9 s into a 12 s hook the native dialog was on screen. Hook allow at 12 s dismissed the dialog and ran the command ("Allowed by PermissionRequest hook") | A true first-answer-wins race, with Claude Code's own dialog (including "always allow") as the local side |
| R5 | Local answer first? | Answering the dialog at ~4 s ran the command immediately. The hook process was **not** cancelled: it ran to its end (12 s) and its output was ignored | The hook cannot learn about a local answer by itself; the Bridge must learn it from other events |
| R6 | What does the hook receive on stdin? | `session_id`, `transcript_path`, `cwd`, `prompt_id`, `permission_mode` (`default`), `hook_event_name`, `tool_name`, `tool_input`, `permission_suggestions`. **No `tool_use_id`** | The hook generates its own prompt id; a local answer is matched by `session_id` + `tool_name` + `tool_input` |
| R7 | Can one plugin ship a mod module and a command hook? | **Yes.** `hooks/hooks.json` with both `"modules": [...]` and `"hooks": { "PermissionRequest": [...] }` validated and the command hook fired with no extra settings | One plugin, one install |
| R8 | Mode switching in the driven session | Shift+Tab cycles manual → accept edits → plan → manual; `auto` is reachable only with `--permission-mode auto` **and a model that supports it** (Haiku 4.5 stayed "manual mode on"; Sonnet 5.5 gave "auto mode on") | Auto-mode checks need Sonnet or larger |

### Decisions

1. Permission Requests move from the mod's `tool.check` hook to a **`PermissionRequest` command hook** shipped in the same plugin (ADR-0002). The mod no longer opens its own Allow/Deny dialog.
2. The Bridge resolves a pending Permission Request as answered locally when it sees the session move on: `PostToolUse`/`PostToolUseFailure` for the same tool and input, or `Stop`, `UserPromptSubmit` or `SessionEnd`.
3. AskUserQuestion stays on the mod's `tool.call` hook (it is asked of the human in every mode).

## E2E findings

Run 2026-10-06 against a scratch Bridge (the real Bridge code with a fake Telegram channel and a test-only answer endpoint, on an isolated `XDG_RUNTIME_DIR`), with the worktree's plugin loaded by `--plugin-dir` into pty-driven sessions. Claude Code 2.1.291.

| ID | Mode | Scenario | Result |
|---|---|---|---|
| E-A | default (Haiku) | Permission Request, answered Allow from the fake Telegram | The Bridge held one pending prompt while the native dialog (with "always allow") stayed open. The remote Allow dismissed the dialog, the command ran, the note read "✅ Allowed (remote)" |
| E-B | default | Same, answered in the terminal | The command ran; the mod's `tool.call` hook reported it finished; the Bridge settled the prompt: "☑️ Answered in the terminal", nothing pending |
| E-C | default | Remote Deny | The command did not run; Claude reported the denial; note "❌ Denied (remote): …" |
| E-D | **auto** (Sonnet 5.5) | A harmless command the classifier approves | Ran with **no dialog, no Telegram prompt**, nothing pending. This is the reported bug, fixed |
| E-E | auto | AskUserQuestion answered remotely | Claude received the answer. **Bug found:** the `PermissionRequest` hook also fired for `AskUserQuestion` (its dialog is a permission dialog) and registered a bogus "Permission: AskUserQuestion" prompt. Fixed: the hook ignores that tool. Re-run: only the real question is pending, and it resolves |

Known limitation confirmed again: after a remote Answer to a Question, the terminal's question dialog stays open until Esc.
