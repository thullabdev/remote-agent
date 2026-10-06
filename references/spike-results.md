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

## E2E findings

(Filled in after Task 13 Step 7.)
