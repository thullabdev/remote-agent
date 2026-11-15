# Chat list: UI/UX critique

Date: 2026-11-09 · Scope: the session list screen (`src/ui/components/chat-list.tsx`) on a phone, reviewed from a screenshot and then checked against the code.

Each issue has an ID (`CL-n`) so it can be discussed, ticketed or closed on its own. Priority: **P0** blocks the product's core job, **P1** clearly hurts daily use, **P2** polish.

## Framing

The product's purpose, from `CONTEXT.md`: let the user watch and steer sessions remotely and answer Prompts (Questions and Permission Requests) so a blocked session continues.

The screen is clean and the dark theme is well executed, but it reads as a generic messaging list. The question a user opens it with is "is anything blocked on me, running, or done?" and the list answers that poorly.

## Corrections to the first-pass critique

These were wrong in the screenshot-only review and are **not** issues:

- Status is not entirely missing. `Chat` has `busy`, `unread` and `status: 'ended'`, and the row renders an unread pill, an "Ended" badge and "Working…". The screenshot simply had no such rows. The real gap is described in CL-1 and CL-4.
- The tabs do not overflow. `SessionFilterTabs` measures widths and collapses extras into a "More" menu (`chat-list.tsx:46-130`).
- Multi-select archive exists, via a 500 ms long-press (`chat-list.tsx:348-362`). The problem is discoverability (CL-11).

## Summary

| ID | Priority | Issue |
|---|---|---|
| CL-1 | P0 | "Needs you" (pending Prompt) is not represented anywhere |
| CL-2 | P0 | Previews leak raw markdown (server bug against the documented contract) |
| CL-3 | P0 | Filters and the "Active Session" label are named after the wrong axis |
| CL-4 | P1 | "Working…" replaces the preview and is visually weak; `busy` can stick |
| CL-5 | P1 | Avatars carry no information |
| CL-6 | P1 | Row layout: too many things on the title line, titles truncate |
| CL-7 | P1 | Titles are inconsistent and the project is not shown |
| CL-8 | P1 | Row density is too low for 20+ sessions on a phone |
| CL-9 | P2 | Text sizes of 9-10px |
| CL-10 | P2 | Pinning: the pin icon only ever appears on General |
| CL-11 | P2 | Long-press selection is hidden and silently ignored on live rows |
| CL-12 | P2 | Footer "Connected" state is always visible and uses jargon |
| CL-13 | P2 | Header: decorative logo, small settings icon, `+` out of thumb reach |
| CL-14 | P2 | "CHATS 20" label duplicates the "All" tab |

---

## CL-1 · P0 · "Needs you" is not represented

**What the user sees.** A session blocked on a Permission Request looks like any other row with a small unread count, indistinguishable from "agent finished a turn".

**Evidence.**
- `Chat` (`src/channel/web/protocol.ts:8-22`) has no pending-prompt field. A Prompt is only a `prompt` message.
- `UNREAD_KINDS` is `('agent_text', 'prompt', 'system')` (`chat-log.ts:15`), so a prompt is counted as one unread among many.
- The list sorts by `lastMessage.at`, so a blocked session sinks as other sessions get newer messages.

**Why it matters.** This is the reason the product exists. An agent waiting for an allow/deny while the user is away is wasted time, and the user cannot see it without opening each chat.

**Recommendation.**
1. Add `pendingPrompt: { kind: 'question' | 'permission' } | null` to `Chat`, derived from prompt messages with `status: 'pending'`.
2. Render a distinct state on the row (amber accent plus a "Needs you" label or "Permission" / "Question").
3. Group or sort these chats above the rest, and offer a "Needs you" filter (see CL-3).

**Done when.** A blocked session is identifiable and reachable from the list in one glance and one tap, without opening other chats.

---

## CL-2 · P0 · Previews leak raw markdown

**What the user sees.** Previews such as `` The fix is committed as `7ade68a`… ``, `## Lino's "under 10 a day"…`, `` …with `bunx release-ple… ``.

**Evidence.** `previewOf()` (`chat-log.ts:117-121`) does `markdown.slice(0, 140)` on raw `agent_text`. The handoff doc (`docs/superpowers/specs/2026-11-04-web-channel-ui-handoff.md`, §4) states that `lastMessage.preview` is "plain text, for the list only". The code does not meet that contract.

**Also.**
- A `tool_run` preview is just the tool name.
- The cut is at 140 characters then CSS-truncated, so users see a fragment from the start of the message, often not the conclusion.

**Recommendation.**
1. Strip markdown in `previewOf` (headings, backticks, emphasis, links, list markers), collapse whitespace, then cap.
2. For `tool_run`, show something meaningful (for example "Ran Bash: bun test") rather than the bare tool name.
3. Consider previewing the end or first sentence of a long agent message, not an arbitrary 140-character prefix.
4. Add a test next to the existing `chat-log` tests.

**Done when.** No `` ` ``, `#`, `**` or `[]()` appears in any list preview.

---

## CL-3 · P0 · Filters and labels are named after the wrong axis

**What the user sees.** Tabs "All / Active Session / Spawned / Archived", plus an "Active Session" or "Spawned" badge on every row.

**Evidence.**
- `SESSION_FILTERS` (`chat-list.tsx:25-30`) maps "Active Session" to the internal value `'laptop'`, which means "not spawned" (`filterChats`, `:158-170`).
- Spawned sessions are active too, and ended ones are neither. So "Active Session" is simply wrong.
- `CONTEXT.md` defines **Spawned Session** but has no "Active Session"; the UI invented its own term.
- The row badge (`:399-402`) repeats the same split on every row. In the screenshot "Spawned" is on 8 of 9 rows, so it carries no information.
- Origin (who started it) is mixed with state in one control, and users rarely filter by origin.

**Recommendation.**
1. Filter by state: **Needs you · Running · Ended · Archived**, with counts (CL-1 and CL-4 supply the data).
2. Demote origin to a small icon, or show it only in the chat details panel (`chat-info.tsx`).
3. Remove the per-row badge, which also frees title width (CL-6).
4. Use the `CONTEXT.md` vocabulary in the UI, or update `CONTEXT.md` if "Laptop session" is a term worth keeping.

**Done when.** Every filter name describes a state the user cares about, and no label contradicts the domain language.

---

## CL-4 · P1 · "Working…" replaces the preview, is weak, and `busy` can stick

**Evidence.**
- `:422` shows `chat.busy ? 'Working…' : preview`. The last message is lost whenever the agent is working, which is exactly when the user wants context.
- It is plain muted text with no motion or color, so it looks like a static placeholder.
- `web-channel.ts:319-335` documents that a delivered instruction with no `turn_complete` (for example an Esc interrupt) leaves the chat busy until the session ends.

**Recommendation.**
1. Show a running indicator (spinner or pulse on the avatar) and keep the preview visible.
2. Before adding a spinner, fix or time-box the sticky-busy case. Otherwise a stuck session looks alive forever.
3. This state feeds the "Running" filter (CL-3).

**Open question.** How often does sticky-busy happen in practice? This is not measured yet.

---

## CL-5 · P1 · Avatars carry no information

**Evidence.** `Avatar` (`ui/avatar.tsx`) renders the first letter of the title on one flat `bg-muted`. In the screenshot, "R" appears three times (`remote-agent · 7df5fc29`, `Remote Agent Repo readiness`, plus one more) and nothing differs between rows. At `size-11` this is a lot of space for no signal.

**Recommendation.** Use `chat.project` (already on `Chat`) to pick a stable color or glyph per project, so rows from the same repo group visually. Put the status indicator (CL-1, CL-4) on the avatar corner. Keep ⌘ for General.

---

## CL-6 · P1 · Too much on the title line

**Evidence.** The title line (`:397-413`) holds title, source badge, pin, "Ended" badge and time. The title gets what is left, hence "Address Explore Cabinet and Doc…". The preview line holds the preview and the unread pill.

**Recommendation.**
- Line 1: title (semibold) and time.
- Line 2: plain-text preview, with the unread or status pill on the right.
- Line 3 (optional, small): project, plus "Ended" as text.
- Remove the source badge (CL-3). The title and preview are currently almost the same size, so strengthen the hierarchy with weight and contrast rather than adding labels.

---

## CL-7 · P1 · Titles are inconsistent and the project is hidden

**Evidence.**
- `Chat.title` comes from the session title (`mod/remote-agent/bin/title-hook.ts`) or falls back to `project · shortid` "until it has one" (handoff §4). That gives `remote-agent · 7df5fc29` next to "P1 Investigate Datadog alert".
- `chat.project` is only used as a preview fallback (`:422`), never displayed on its own.

**Recommendation.** Show the project as a subtitle or avatar color (CL-5), and treat a hash-based title as a loading state. Let the user rename (a `custom_title` already exists in the DB, `chat-log.ts:55`).

---

## CL-8 · P1 · Row density

**Evidence.** Rows are `py-3` with a `size-11` avatar and `space-y-1` (`:380`, `:394`), about 9-10 rows per phone screen. With 20 sessions and many older than 7h, the user scrolls past a lot of dead weight.

**Recommendation.** Tighten padding and avatar size on small screens, and group by time or state so old, finished sessions collapse (for example an "Earlier" group). Consider a compact mode in settings.

---

## CL-9 · P2 · Text sizes of 9-10px

**Evidence.** `text-[9px]` badges (`:400`, `:406`), `text-[10px]` time (`:410`), unread pill (`:426`) and the section label (`:329`). These are below comfortable mobile reading size, and a recent commit ("raise secondary text contrast") shows contrast has already been a problem.

**Recommendation.** Set a floor of about 11-12px for anything the user must read, and revisit once badges are removed (CL-3).

---

## CL-10 · P2 · Pinning

**Evidence.** The handoff says `pinned` is true for General only, so the pin icon (`:404`) can only appear on one row. It is a permanent decoration, not a feature.

**Recommendation.** Either remove the icon and make General a distinct fixed header row, or add real pinning for sessions (the server already has `PinSchema` for messages, but chats have no user-pin endpoint to my knowledge; verify before promising it).

---

## CL-11 · P2 · Long-press selection is hidden and silently ignored

**Evidence.** Selection starts on a 500 ms long-press, but only for ended, non-archived chats (`isSelectableChat`, `:152-154`; handlers `:348-362`). On any live row it does nothing, with no feedback, and nothing tells the user it exists. Desktop has no equivalent.

**Recommendation.** Add a visible affordance (a "Select" action in the header menu), show why a live row cannot be archived, and consider a swipe action for archive on ended rows.

---

## CL-12 · P2 · Footer "Connected" state

**Evidence.** `:452` shows "Connected to your Bridge" permanently. "Bridge" is a defined domain term, but not one a user chooses to learn. A message that is always on becomes invisible, and it sits right above the gesture bar.

**Recommendation.** Show nothing when connected. Show a banner for reconnecting, syncing or error, and use plainer language ("Can't reach your computer").

---

## CL-13 · P2 · Header

**Evidence.** The header (`:296-327`) holds the brand mark, search, settings and `+`. The logo has no function, the settings icon is small (`icon-sm`), and the primary action `+` is in the top-right corner, which is the hardest area to reach on a tall phone. `+` has an `aria-label` but no visible label to distinguish "new session" from "new chat".

**Recommendation.** Drop or shrink the logo on mobile, collapse search into an icon or pull-to-reveal, and consider a bottom-right primary action.

---

## CL-14 · P2 · "CHATS 20" label

**Evidence.** `:329-331` renders a tiny uppercase "Chats" label and count under the tabs. The count duplicates "All", and it uses 10px text (CL-9).

**Recommendation.** Remove it, or replace it with real group headers (Needs you / Running / Earlier) that earn their space.

---

## Suggested order of work

1. **CL-2** — markdown stripping in `previewOf`. Small, low risk, immediate visual payoff.
2. **CL-1** — add `pendingPrompt` to `Chat` and render it. Highest product value.
3. **CL-3** — replace the filter tabs and drop the source badge.
4. **CL-4 / CL-5 / CL-6** — rebuild the row once the data exists.
5. P2 items as polish.

## Not verified

- How often `busy` actually sticks (CL-4).
- Whether chat-level pinning for sessions is supported server-side (CL-10).
- Swipe or gesture behavior beyond what the code shows. This review is from one screenshot plus the source, not a usability test.
