# Chat list: review of the earlier critique, new findings, and a fix plan

Date: 2026-11-09. Scope: the session list on a phone (`src/ui/components/chat-list.tsx`). Inputs: the Chrome screenshot (Android, dark theme, about 412 dp wide), `docs/ui-critique-chat-list.md` (CL-1..CL-14), and the code at HEAD `bcff4eb`. Read-only on source; nothing was run in a browser. I did not execute the test suite.

Core question: "Away from my laptop, can I tell at a glance which sessions are blocked on me, running, or done, and act on them quickly?"

**Short answer: no, and in one case the screen actively lies.** A session blocked on a Permission Request is shown as "Working…" (section 2, CL-15). The previous critique asked for a "Needs you" state; the code shows it must first stop being mislabelled as "Working".

Screenshot caveat: it predates commit `bcff4eb`, so the raw-markdown previews in it are already fixed. In the screenshot all 9 visible rows are idle (no spinner, no unread pill, no Ended badge). So it shows none of the states the user cares about, which is itself the finding: the list's default look is "nothing to tell you", and the user cannot distinguish "all quiet" from "the UI has no way to say".

---

## 1. Verdict on CL-1..CL-14

| ID | Verdict | Evidence |
|---|---|---|
| CL-1 No "needs you" | **CONFIRMED, and worse** | `Chat` has no prompt field (`protocol.ts:6-21`). Prompts count as 1 unread among many (`chat-log.ts:15`, `:644`). Sort is recency only (`api.ts:211-219`, `realtime.ts:28-38`). Worse: a blocked chat is `busy`, so the row says "Working…" (CL-15). |
| CL-2 Markdown in previews | **FIXED, but incomplete** | `stripMarkdown` (`core/text.ts:57-73`) used only for `agent_text` (`chat-log.ts:120`). See section 1.1. |
| CL-3 Filters named after wrong axis | **CONFIRMED** | `'laptop'` labelled "Active Session" (`chat-list.tsx:25-30`, `:158-169`). `CONTEXT.md` has no such term. Correction: in the screenshot 7 of the 9 visible rows say "Spawned" (the critique said 8 of 9). |
| CL-4 "Working…" / sticky busy | **PARTLY** | "Working…" replaces the preview: confirmed (`chat-list.tsx:422`). Sticky busy: mostly **refuted**. The transcript reader now drives busy (`transcript/reader.ts:280-283`, `:368-375`; wired at `bridge/app.ts:107-112`), and Esc interrupts end the turn (`parse.ts:21-31`). The comment at `web-channel.ts:319-322` ("transcript reader (a later task)") is stale. Residual risk: `instructionDelivered` sets busy itself (`web-channel.ts:274`) independently of the reader. |
| CL-5 Avatars carry no info | **CONFIRMED** (one correction) | `avatar.tsx` is first letter on flat `bg-muted`. The "R" appears twice in the screenshot, not three times. |
| CL-6 Crowded title line | **CONFIRMED** | Title, source badge, pin, Ended badge, time share one line (`chat-list.tsx:397-413`). |
| CL-7 Titles/project hidden | **PARTLY** | Project only used as preview fallback (`:422`): confirmed. "Let the user rename" is **already built**: `renameChat` (`ui/api.ts:127`, `chat-info.tsx:43`), `api.ts:89`. It is just two taps deep in the details panel. |
| CL-8 Density | **PARTLY** | `py-3` + `size-11` (`:380`, `:394`) is about 72 dp per row. But a density preference already exists (`styles.css:145-146`, `app.tsx` `density-${...}`); it only affects the message feed, not the list. Cheap win: honor it in the list. |
| CL-9 9-10 px text | **CONFIRMED** | `text-[9px]` (`:400`, `:406`), `text-[10px]` (`:329`, `:410`, `:426`), `text-[11px]` footer (`:449`). Six sites. |
| CL-10 Pinning decorative | **CONFIRMED, and now verified** | Open question resolved: no chat-pin endpoint exists. The only pin API is for messages (`api.ts:526-535`); `updateChat` cannot set `pinned` (`chat-log.ts:223-231`); only General is inserted pinned (`:186`). |
| CL-11 Hidden long-press | **CONFIRMED** | `isSelectableChat` only ended and unarchived (`:154-156`); handlers `:349-362`; no keyboard path at all. Server enforces it (`api.ts:462-466`). |
| CL-12 Footer | **CONFIRMED, with a sharper problem** | `:449-454`. "Connected" is set on WebSocket open only (`use-web-channel.ts:~147`); with no pong check it can stay green on a dead socket (CL-21). |
| CL-13 Header | **PARTLY** | Settings is `icon-sm` = 32 px (`button.tsx:21`), `+` is 40 px, logo is non-interactive (`chat-list.tsx:292`): confirmed. The claim that `+` is ambiguous with "new chat" is weak: its label is "Start a new session" (`:322`). |
| CL-14 "CHATS 20" | **PARTLY** | It shows the *filtered* count (`:330`), so it changes with search/filter and is not a pure duplicate of "All". Still low value at 10 px; better replaced by the counts on the state chips. |

The critique's "Corrections" section is right on all three counts (status exists, tabs do not overflow, multi-select exists). One caution on tabs: they collapse into "More" in order (`:35-47`, `:86-107`). If "Needs you" is not the first chip, it is the first to be hidden on a narrow phone.

### 1.1 Is the CL-2 fix complete?

The fix is sound for the case in the screenshot, with tests at `test/core/text.test.ts:76-87` and `test/channel/web/chat-log.test.ts:240-243`. Gaps:

1. **Prompt previews show the wrong thing.** `previewOf` uses `body.title` for prompts (`chat-log.ts:119`), and that title is `sessionLabel(session)` (`web-channel.ts:177-180`), i.e. the session's own name, not the question or tool. A blocked chat's preview is its own title again. The push text does it right (`promptPushText`, `web-channel.ts:398-404`), so the data exists; the list ignores it.
2. **`tool_run` preview is the bare tool name** (`chat-log.ts:119`), e.g. "Bash".
3. **Only `agent_text` is stripped** (`:120`). `command_reply` (slash-command output, likely markdown), `system`, `user_text` are not.
4. **Unhandled markdown:** tables (`| a | b |`), HTML tags/`<br>`, reference-style links, backslash escapes, `~~~`-fenced content kept as words (the test at `text.test.ts:81` intentionally keeps code as text, which in a preview often reads as noise).
5. **The 140-char prefix problem is real but secondary.** The phone shows about 45 characters on one line (screenshot), so `PREVIEW_MAX = 140` (`chat-log.ts:13`) is not the bottleneck; the single-line CSS clamp is. The bigger issue is that the prefix of an agent message is rarely the conclusion.
6. **No author cue.** When the last message is the user's instruction, the preview shows it with no "You:" prefix, so it reads as the agent speaking.
7. **`.slice(0, 140)` is UTF-16**, so it can cut a surrogate pair (emoji) in half. Use `Array.from` or `Intl.Segmenter`.
8. **Cost (unmeasured).** `stripMarkdown` runs on the full message in every `toChat` (`chat-log.ts:657`), i.e. for every chat on every `/api/state` and on every `chat.updated`. Agent messages can be tens of KB, and the bold regex uses lazy `[\s\S]*?` (`text.ts:68`), which can degrade on unmatched `**`. I did not benchmark it. Cheap mitigation: slice the source to about 2 KB before stripping, or cache the preview on the message row.

---

## 2. New findings

Priority: P0 breaks the core job; P1 hurts daily use; P2 polish.

### State and data

**CL-15 · P0 · A blocked session reads "Working…"**
Evidence: the transcript reader sets `tail.open = true` for any non-`turn_end` entry (`reader.ts:278-283`) and reports busy while open (`:368-375`). A session waiting on a Permission Request has an open turn. The row prints `chat.busy ? 'Working…'` (`chat-list.tsx:422`); the header says "Working on your instruction" (`chat-header.tsx:47`); the feed shows a working indicator (`message-feed.tsx:166`); details says "Working" (`chat-info.tsx:117`).
Impact: the screen says the opposite of the truth in exactly the case the product exists for. The user sees "Working…" and goes back to their day.
Caveat: I did not reproduce this live. It follows from the code path; `test/channel/web/` should get a test that proves it (phase 1).

**CL-16 · P0 · A draft hides busy, unread-prompt and last message**
Evidence: `chat.draft !== null` is checked before everything else (`chat-list.tsx:415-420`). In the screenshot, `remote-agent · 7df5fc29` (52m) and General show "Draft:". A session with a draft cannot show "Needs you" or "Working".
Impact: typing half a reply, then leaving, buries the state. Also General carries a stale `/new -m sonnet` draft in the most prominent row.
Fix: the draft becomes a secondary marker (small pencil icon + "Draft" in the metadata line), never a replacement for state or preview.

**CL-17 · P1 · Pending prompt can go stale on the client, and on ended chats**
Evidence: `updateMessage` emits `chat.updated` only when the updated message is the chat's last visible one (`chat-log.ts:313-315`). A prompt answered after other messages arrived (multi-question prompts append several prompt messages, `web-channel.ts:196-217`; agent text can land between) will not refresh any derived "pending" flag on the list. And `chatEnded` (`web-channel.ts:309-316`) does not settle pending prompt messages. Whether the Bridge answers/cancels pending prompts when a session ends is not something I verified (`notifier.ts:254-` was not read in full).
Impact: a naive `pendingPrompt` derived from message status would show stale "Needs you" forever. Design in section 3.1 handles it.

**CL-18 · P1 · "Unread" has weak semantics for this product**
Evidence: unread kinds are `agent_text`, `prompt`, `system` (`chat-log.ts:15`). (a) One agent turn that emits 12 text messages becomes a "12" badge. (b) The auto-generated "Session started in …" and "Session ended (…)" system messages (`web-channel.ts:293`, `:298`) count as unread, so every new or ended session gets a badge nobody asked for (likely; not verified in a browser). (c) A prompt is just "1 more". (d) One global cursor shared by all devices (`chat-list.tsx` has no per-device notion; `chat-log.ts:453-466`): reading on the laptop silently clears the phone badge, which is arguably desired but should be documented.
Impact: the pill carries a number that rarely means anything. What the user needs is a boolean ("something new since you looked") plus a separate "needs you" signal.

**CL-19 · P1 · Ordering reshuffles under the thumb and buries blocked work**
Evidence: order is General first, then `lastMessage.at` desc, both server (`api.ts:211-219`) and client (`realtime.ts:28-38`). Every `appendMessage` emits `chat.updated` (`chat-log.ts:293`), including each `tool_run`, which also counts as `lastMessage`. A running session therefore jumps to row 2 on every tool call. Rows move while the user is about to tap them (mis-taps), and a session that has been blocked for an hour sinks below a chatty one.
Also: `createRealtimeState` does not call `orderChats` (`realtime.ts:15-26`); it relies on the server's sort, and `listChats` itself orders by `pinned, created_at` (`chat-log.ts:322`), so any other consumer of `listChats` gets a different order (e.g. `test/bridge/http.test.ts:204`).
Impact: the ordering has no notion of "who needs me".

**CL-20 · P1 · Search scope is title only**
Evidence: `chat.title.toLocaleLowerCase().includes(...)` (`chat-list.tsx:162`, `:167`). It does not search project, cwd, the preview, or message content, and gives no match highlight. In the screenshot, titles like "remote-agent · 7df5fc29" and "On Call Verify Self-assignment" mean users search by repo or topic, not title. Search also hides the state filter's meaning (filters AND search, with no visible "filtered" cue besides the count).

### Realtime and freshness

**CL-21 · P1 (P0 if reproducible) · A stale list can look live**
Evidence: the client pings every 30 s but never checks for a pong or a timeout (`use-web-channel.ts` ping interval; `status` is set to `connected` on `open` only, `:~147`). `visibilitychange` only sends presence (`:~72-85`, `:~213`); `sendPresence` returns early when the socket is not OPEN. It does not reconnect, resync or re-fetch on return to foreground. On Android, a backgrounded tab's socket can be frozen or half-open. The footer would still say "Connected to your Bridge".
Impact: for a "check from the phone" product, the worst outcome is trusting a stale list. How often this happens is unverified (see open questions).

**CL-22 · P2 · No pull-to-refresh, and the native one is disabled**
Evidence: `overscroll-behavior: none` on `body` (`styles.css:44`) disables Chrome's pull-to-refresh, and the app has none of its own. Combined with CL-21, the user has no manual way to force a refresh in an installed PWA other than killing the app. `reload()` exists (`use-web-channel.ts`, `reloadKey`) and is only wired to the full-page error.

**CL-23 · P2 · Relative times do not tick**
Evidence: `formatRelativeTime(chat.lastMessage.at)` with default `now = Date.now()` (`chat-list.tsx:411`, `presentation.ts:67-79`), evaluated only on render. With no new events the "12m" stays "12m" until something else re-renders. Compounds CL-21.

### Layout, touch, accessibility

**CL-24 · P1 · Filter chips scroll away**
Evidence: `SessionFilterTabs` is rendered inside the scrolling container (`chat-list.tsx:327-328`), not in the fixed header. After scrolling 20 rows, the user has to scroll back to change filter. Search stays pinned (header `:291`), filters do not.

**CL-25 · P1 · Touch targets**
Evidence: filter chips `h-8` = 32 px (`button.tsx:18`, used at `chat-list.tsx:76-84`) with 4 px gaps (`:74`); settings 32 px (`button.tsx:21`); search 40 px (`:315`). Common guidance is at least 44-48 px. Rows themselves (about 72 dp) are fine. Chips with 4 px gaps are easy to mis-tap, which matters when the chip is the way you reach "Needs you".

**CL-26 · P1 · Thumb reach**
Evidence: all controls, including `+` and filters, sit in the top 20% of the screen (screenshot; header `:291-325`). Bottom 10% is a passive footer that is always on. The primary action and the main filter are in the hardest-to-reach zone. Pair with CL-24: moving the chips to a sticky strip is half the fix, a bottom-right "+" or a bottom filter bar is the other half.

**CL-27 · P1 · Accessibility defects in the row**
- `aria-pressed` is set on every ended chat row even outside selection mode (`chat-list.tsx:376`), so screen readers announce a toggle button for a plain navigation row.
- The accessible name is the concatenation of title, badge text, "Pinned", "12m", preview and count (no explicit label), with no state semantics. State will be color/shape-only unless it is in the text (see 3.2).
- Time has no `<time>` or readable label.
- Selection mode has a live region for the count (`:294`) but nothing announces a chat changing to "Needs you".
- Off-screen on mobile, the list is only translated (`-translate-x-full`, `:285-287`), not `inert`/`aria-hidden`, so keyboard and screen-reader focus can still land in the hidden list while a chat is open.
- No keyboard or screen-reader path to multi-select (long-press only).
- Contrast: not measured. The theme system has 14 themes x 7 accents (`themes.ts`), so `--muted-foreground` on `--background`/`--muted` can differ widely. A recent commit already raised secondary text contrast. Recommend a test that computes contrast over every theme/accent pair (see phase 7).

**CL-28 · P1 · Status colors cannot reuse `primary`**
Evidence: `primary` is user-selectable (`ACCENTS`, `themes.ts:142-170`; amber accent is `#e0aa50` in dark). The unread pill and "Draft:" currently use `primary` (`chat-list.tsx:417`, `:426`). If "Needs you" were amber, an amber-accent user could not tell it from an unread pill. Status needs its own semantic tokens (`--status-needs`, `--status-running`, `--status-done`, `--status-ended`), defined per theme and mode, never derived from the accent, and never color-only.

**CL-29 · P2 · Visual hierarchy (from the screenshot)**
Title (`text-sm font-medium`) and preview (`text-xs`) differ little in weight or contrast; the eye goes to the brightest large element, which is the avatar column of identical gray squares. Nothing on the left edge or right edge encodes state. The strongest colored element on the screen is the blue `+`, then the "Draft:" label: neither is about the agents. The four "tabs" are all the same visual weight as the active one's pill, so filter state is subtle. The 7h-old finished sessions are rendered exactly as vividly as the 12m-old ones.

**CL-30 · P2 · Empty and loading states**
- Initial load is a full-page spinner (`app.tsx` `FullPageState`, "Connecting to the Bridge…"), not a list skeleton; fine for a second, poor on a slow phone link.
- The "All" empty state ("Your chats will appear here.", `chat-list.tsx:439`) is practically unreachable because General is always in `All`.
- Per-filter empty texts name the wrong concepts ("No active sessions", `:441`) and have no call to action ("Start a session").
- Failure after load (socket down) is only a 11 px footer dot and text.

### Scale and consistency

**CL-31 · P2 · Many chats: the payload and render cost grow without bound**
Evidence: `state()` ships every chat including archived (`api.ts:222-227`, `listChats` has no filter, `chat-log.ts:320-325`), and `toChat` runs an unread COUNT, a last-message query and a preview strip per chat (`:641-660`). Client: no virtualization; every `chat.updated` creates a new array, re-sorts (`realtime.ts:86-89`) and re-renders every row (inline closures, no `memo`, `chat-list.tsx:333-433`). At 20 chats this is nothing; at a few hundred (archived sessions accumulate forever) both `/api/state` and resync get slow. Not measured.

**CL-32 · P2 · Vocabulary drift**
"Active Session", "Chats", "sessions" (search placeholder, `:312`), "Search chats" (aria label `:311`), "Bridge" in the footer, "Spawned". `CONTEXT.md` calls the object a Session on the machine and a Chat its web form. Pick user-facing words: "Session" everywhere in the list, "Computer" for the Bridge (or hide it), and drop "Spawned" from rows.

**CL-33 · P2 · Desktop vs mobile**
On desktop the list is a resizable sidebar (`:283-290`, `:455-469`) and the active row is highlighted; on mobile the list is a full-screen sheet that slides away. Row design should work at 260-560 px; on desktop the same state chips are fine but quick actions could appear on hover. No mouse right-click, keyboard or hover alternative for selection or archive.

**CL-34 · P2 · Stale comment and docs**
`web-channel.ts:319-322` says the transcript reader is a later task and busy can stick; the handoff (§4 line 57) still says `busy` shows "typing…" and `docs/web-channel-developer-guide.md` documents unread kinds (line 31). Both need an update with any change below.

---

## 3. Suggestions

### 3.1 Data model and API

Goal: make the four states derivable from one place so the list, the header, push and details agree.

**New `Chat` fields** (`src/channel/web/protocol.ts:6-21`):

```ts
/** What the Session is waiting on you for, oldest first. Null when nothing is pending or the chat has ended. */
pendingPrompt: {
  promptId: string
  kind: 'permission' | 'question'
  /** One line, plain text: "Bash: bun test" or the first question. Same text the push uses. */
  summary: string
  /** When it was raised, so the list can show "waiting 4m". */
  at: number
  /** How many prompts are pending in this chat. */
  count: number
} | null
/** What the list should show as the agent's current work, e.g. "Running Bash: bun test". Null when idle. */
activity: string | null   // optional, phase 4
```

Keep `busy` as is for now, but redefine its documented meaning to "a turn is open" and let the UI compute:

```ts
// src/ui/presentation.ts
export type ChatState = 'needs_you' | 'working' | 'idle' | 'ended'
export function chatState(chat: Chat): ChatState {
  if (chat.status === 'ended') { return 'ended' }
  if (chat.pendingPrompt !== null) { return 'needs_you' }   // wins over busy
  if (chat.busy) { return 'working' }
  return 'idle'
}
```

(Pure function, unit-tested; no `if (x) return` one-liners.)

**Deriving `pendingPrompt` in `ChatLog.toChat`** (`chat-log.ts:641`): query the chat's prompt messages whose stored `status` is `pending`:

```sql
SELECT id, body, created_at FROM messages
WHERE chat_id = ? AND seq > ? AND kind = 'prompt' AND json_extract(body, '$.status') = 'pending'
ORDER BY seq
```

Use only when `record.status === 'active'`. Build `summary` with the same logic as `promptPushText` (`web-channel.ts:398-404`); move that function to a shared module so previews and pushes agree. `count` = rows; `promptId` of the first.
Note: the existing `promptId` groups multi-question prompts into several messages, so group by `promptId` when counting.
Alternative (more authoritative): read `prompts WHERE status='pending'` from the `Store` (`store.ts:285-291`). That ties the chat log to the prompt table; I would only do that if "pending message but answered prompt" mismatches are seen. I did not check the `prompts` column names; verify before writing SQL.

**Emit when pending changes** (fixes CL-17): in `updateMessage` (`chat-log.ts:300-317`) also emit `chat.updated` when the old or new body is a `prompt` and its `status` changed, not only when it is the last message. Same for `appendMessage` of a prompt (already emits, `:293`).

**Ended chats:** on `chatEnded`, `pendingPrompt` is hidden by the `status === 'active'` guard. Separately decide whether to mark such prompt messages `answered` with a note "Session ended" (needs the Bridge behaviour verified; open question).

**Preview fixes (`previewOf`, `chat-log.ts:117-121`):**
- `prompt`: shared `promptPushText(body)` (kind-prefixed): "Permission: Bash: bun test" / "Question: Which database?". Strip markdown.
- `tool_run`: `"Ran <tool>"` plus a short input summary if the tool has a known summarizer (reuse `permissionSummaryFull` if its output is plain), else `Ran <tool>`; running status: "Running <tool>".
- `user_text`: prefix `You: `.
- `command_reply`, `system`: also strip markdown.
- Cut by grapheme/code point, slice source to about 2 KB first.
- Option (A/B test): for long `agent_text`, use the last non-empty paragraph.

**Unread semantics:** exclude auto `system` messages from `UNREAD_KINDS` except reminders (or add `counts_unread = 0` when appending "Session started/ended", using the existing column, `chat-log.ts:16-19`). In the UI render a dot, not a number; keep the count in the details panel. This is a behaviour change: update `developer-guide.md:31`.

**Ordering:** introduce `lastActivityAt` (time of the latest `agent_text`, `prompt`, `user_text`; excludes `tool_run`) so a running chat does not jump on every tool call. Server `byRecency` and client `orderChats` become one shared function (e.g. `src/channel/web/order.ts`, used by both; the UI already imports types from `channel/web`) with tiers: `needs_you` (oldest pending first), `working`, then the rest by `lastActivityAt`. General leaves the top (see 3.3). Call it in `createRealtimeState` too.

**Wire compatibility:** `parseServerEvent` only checks `id` and `title` of a `Chat` (`use-web-channel.ts:23-25`). New fields must default safely client-side (`chat.pendingPrompt ?? null`) so a stale service-worker bundle or an older server does not crash. The service worker cache was bumped recently (commit `bd9100e`); a UI change needs the same bump.

**Docs to update:** `protocol.ts` comments, `docs/superpowers/specs/2026-11-04-web-channel-ui-handoff.md` §4 (Chat shape, preview contract, ordering line 88, busy line 57), `docs/web-channel-developer-guide.md` (Chat shape ~line 244, unread line 31, `chat.updated` line 294), `CONTEXT.md` (add the four list states or reuse existing words; there is no "Active Session" term and the UI should not invent one), and the stale comment `web-channel.ts:319-322`.

### 3.2 States and copy

| State | Rule | Label | Look | Preview line |
|---|---|---|---|---|
| Needs you | active and `pendingPrompt` | "Needs you" (row chip: "Permission" / "Question", and "waiting 4m") | amber chip + 3 dp left bar + amber ring on avatar corner | `Allow Bash: bun test?` (summary, plain text) |
| Working | active, `busy`, no pending | "Working" | animated 3-dot or pulsing dot on avatar corner (respect `prefers-reduced-motion`: static dot) | last agent text kept visible, prefixed "Working · " or the `activity` string |
| Done | active, idle | "Done" (no chip; idle is the quiet default) | normal | last agent text; unread = small dot, not a count |
| Ended | `status === 'ended'` | "Ended" | whole row dimmed to about 70% content contrast, gray ring | last text, "Ended 2h ago" in meta |
| Unread | any, `unread > 0` | none (dot) | 8 px dot right of the time, title in semibold | |
| Draft | `draft !== null` | "Draft" (pencil icon) | meta line only, e.g. `✎ Draft` | never replaces the preview or state |

"Done" is defined as "the agent's turn finished and it is waiting for your next instruction", which differs from "Ended" (session closed). The word "idle" is internal.

Status must never rely on color alone: shape (icon), text ("Needs you"), and position (left bar) all carry it. Use semantic tokens (CL-28): `--status-needs`, `--status-working`, `--status-ended`, defined in `themes.ts` per theme and mode, validated for contrast against `--background` and `--muted`.

### 3.3 Layout

**Row (mobile, about 76 dp, two text lines plus meta; avatar 44 dp with a state badge on its corner):**

```
Needs you
+---+--------------------------------------------+
|#  [P] P1 Investigate Datadog alert        4m   |   # = 3 dp amber left bar
|#  (!) Permission  Allow Bash: bun test?        |   (!) = amber badge on avatar
|#      remote-agent  -  waiting 4m   [ Review ] |   Review = 40 dp tall ghost button
+---+--------------------------------------------+

Working
+---+--------------------------------------------+
|   [R] remote-agent - 7df5fc29            now   |
|  (~)  Working - Running Bash: bun test       . |   (~) = pulsing dot; . = unread dot
|       remote-agent                             |
+---+--------------------------------------------+

Done (quiet default)
+---+--------------------------------------------+
|   [U] Upload Files Remote Agent          12m   |
|       The fix is committed as 7ade68a, merged  |
|       into main, and ...                       |   (2-line clamp)
|       remote-agent                             |
+---+--------------------------------------------+

Ended (dimmed)
+---+--------------------------------------------+
|   [O] On Call Verify Self-assignment     10h   |
|       Ended - I checked the PR #42293 desc...  |
|       remote-agent                             |
+---+--------------------------------------------+
```

Rules: line 1 = title (15 px semibold, 1 line) + time (12 px, right). Line 2 = state chip (if any) + preview, clamp to 2 lines when there is no chip, 1 line with a chip. Line 3 (optional, 12 px, muted) = project, and `Draft` marker. No source badge, no pin glyph on every row, no count pills. Minimum text 12 px everywhere. Avatar: color from a stable hash of `project` (hue only, from tokens that pass contrast), General keeps the glyph. The avatar corner holds the state badge, so state is visible even in the narrow column.

**Header and filter area (mobile):**

```
+----------------------------------------------+
| [ Search sessions, projects          ]   (gear)|   fixed header, 56 dp
+----------------------------------------------+
| 2 sessions need you                    [Show] |   only when count > 0, amber strip, 44 dp
+----------------------------------------------+
| ( Needs you 2 ) ( Working 1 ) ( All ) ( ... ) |   sticky chips, 40 dp tall, 8 dp gaps, horizontally scrollable
+----------------------------------------------+
|  rows ...                                    |
|                                              |
|                                        ( + )  |   FAB, bottom right, above the gesture bar
+----------------------------------------------+
```

- Chips: **Needs you (n) · Working (n) · All · Ended · Archived**; counts shown only when above zero except "Needs you" which always shows its state (disabled look at 0). Chips scroll horizontally instead of collapsing into "More", so the first one is never hidden. The origin axis (spawned vs started on laptop) becomes a small icon in details only (`chat-info.tsx:116`), and optionally a "Spawned" toggle in settings.
- The amber strip is the single most valuable pixel on the screen: one tap filters to blocked sessions. It also appears on the app icon badge (`navigator.setAppBadge`, supported by Chrome on Android; progressive enhancement; not verified in this repo).
- Remove the logo from the mobile header (frees 44 dp for search; keep it on desktop). Remove the `CHATS 20` line.
- Footer: render nothing while connected. When not connected, show a top banner under the header: "Can't reach your computer. Showing the last known state from 9:14." with a "Retry" button (wired to `reload()`), and dim the state chips. Include "last updated" so staleness is explicit.
- General: a compact "Commands" row pinned below the chips only when it has unread or a draft, otherwise a ⌘ icon button in the header. (Open question: this removes the always-first row; confirm it is not the main entry point for `/new` on mobile.)

**Quick actions.** Phase 1: a "Review" button on the blocked row opens the chat scrolled to the pending prompt (`promptQuestionIndex` in `presentation.ts:29` shows prompt messages can be located by id). Phase 2 (decision needed): inline "Deny" on permission rows, and Allow only after opening, to keep approvals deliberate. Use the existing `performAction` API (`ui/api.ts:102`). Never offer inline Allow for tools whose summary does not fit in the row.

**Selection and archive:** add "Select" to a header overflow menu, show the reason for non-selectable rows ("Only ended sessions can be archived"), keep the long-press, and add swipe-left to archive on ended rows (with undo toast). Selection checkbox remains `size-11`.

**Search:** match title, project, cwd, preview (client-side, immediate), highlight matches, keep filters applied and show "3 results in All". Message-content search is a separate server feature (SQLite FTS5 over `messages.body` for `agent_text`/`user_text`), phase 7, only if needed.

**Freshness:** pong timeout (e.g. no `pong` within 10 s of a ping means close and reconnect); on `visibilitychange` to visible, if the socket is not OPEN or last event is older than N seconds, trigger `reload()`; a ticking clock (one 30 s `setInterval` at the list level) so times and "waiting 4m" update; a custom pull-to-refresh on the list container that calls `reload()` (body `overscroll-behavior: none` stays).

**Accessibility:** row `aria-label` built from state-first text: "Needs you, permission: Allow Bash: bun test. P1 Investigate Datadog alert, remote-agent, 4 minutes ago." Set `aria-pressed` only in selection mode. `<time dateTime=...>`. `role="status"` live region announcing "Session X needs you" when a chat enters `needs_you` while the list is visible. `inert` on the list when a chat is open on mobile. Minimum 44 dp touch targets for chips and header icons. Honor `prefers-reduced-motion` for the working pulse.

---

## 4. Implementation plan

Conventions: TypeScript uses braces for every `if` (no `if (x) return;` one-liners); commit messages contain no `Co-Authored-By` line; project check scope is `vulcan-*` per `CLAUDE.md`, but this repo is `remote-agent`, so only `src/`, `test/` here. Run `bun test` and `bun run typecheck` after each phase. To see UI changes: `bun run dev` (Vite) against a running Bridge, then open the page on the phone over your Tailscale URL, or use Chrome devtools device mode at 412 x 915 and the dark theme; bump the service worker cache version for installed PWAs (see commit `bd9100e` for where).

Each phase is independently shippable and ends with green tests.

### Phase 0: Reproduce and baseline (S)
- Goal: prove CL-15, CL-21, CL-18(b) before changing behavior.
- Files: add tests only. `test/channel/web/web-channel.test.ts` (busy stays true while a permission prompt is pending), `test/channel/web/chat-log.test.ts` (session started/ended count unread), a scripted manual check for CL-21 (kill Wi-Fi with the tab backgrounded).
- Risk: none. Rollback: delete tests. Depends on: nothing.
- Verify: tests fail or pass as predicted; record results in the PR description.

### Phase 1: Data model and previews (M)
- Goal: server emits `pendingPrompt`, fixed previews, shared ordering, unread fix.
- Files: `src/channel/web/protocol.ts` (new fields), `src/channel/web/chat-log.ts` (`toChat`, `previewOf`, `updateMessage` emit, `UNREAD_KINDS`/`counts_unread` for lifecycle system messages), `src/channel/web/web-channel.ts` (extract `promptPushText`, remove stale comment `:319-322`), `src/core/text.ts` (code-point-safe cut, table/HTML handling), new `src/channel/web/order.ts`, `src/channel/web/api.ts` (use shared order), `src/ui/realtime.ts` (use shared order, call it in `createRealtimeState`), `src/ui/use-web-channel.ts` (safe defaults for missing fields).
- Tests: `test/channel/web/chat-log.test.ts` (pendingPrompt present/cleared on answer even when it is not the last message; hidden for ended; previews for prompt, tool_run, user_text, command_reply; unread excludes lifecycle system messages), `test/core/text.test.ts` (tables, HTML, surrogate pairs, large input), `test/ui/realtime.test.ts` (order tiers, `createRealtimeState` ordered, chat.updated moves chat), `test/channel/web/api.test.ts` (state order).
- Risk: medium (wire shape and unread behaviour change). Mitigation: new fields are additive; defaults on the client. Rollback: revert; additive fields are ignored by old clients.
- Depends on: phase 0. Verify: `bun test test/channel test/core test/ui`, then query `/api/state` with curl and confirm a seeded pending prompt appears.

### Phase 2: State model in the UI (S)
- Goal: single `chatState` function used by list, header, details.
- Files: `src/ui/presentation.ts` (`chatState`), `src/ui/components/chat-header.tsx` (`:47`, `:55-59`: "Needs you" instead of "Working on your instruction"), `src/ui/components/chat-info.tsx` (`:114-118`), `src/ui/components/message-feed.tsx` (`:166` working indicator suppressed while a prompt is pending).
- Tests: `test/ui/presentation.test.ts`, `test/ui/usage-surfaces.test.tsx`-style render tests for header/info.
- Risk: low. Rollback: revert. Depends on: phase 1.

### Phase 3: Row redesign and filters (L)
- Goal: the new row, state chips, "needs you" strip, sticky chips, semantic tokens, a11y fixes, remove `CHATS n`.
- Files: `src/ui/components/chat-list.tsx` (split into `chat-row.tsx` memoized, `chat-filters.tsx`; replace `SessionFilterTabs` and `countFittingTabs`, keep or delete `countFittingTabs` and its tests), `src/ui/themes.ts` (status tokens per theme and mode), `src/ui/styles.css` (token mapping, pulse animation with reduced motion), `src/ui/components/ui/avatar.tsx` (project color + state badge), `src/ui/components/brand-mark.tsx` usage (desktop only), `src/ui/app.tsx` (`inert` on hidden list).
- Tests: rewrite `test/ui/chat-list.test.ts` (filters by state, counts, search over title/project/preview, selection rules), `test/ui/themes.test.ts` (status tokens exist for every theme/mode and pass the contrast threshold), new `test/ui/chat-row.test.tsx` (renders each state, aria-label starts with the state, `aria-pressed` only in selection mode).
- Risk: highest visual risk. Mitigation: ship behind a preference (`src/ui/preferences.ts`, `test/ui/preferences.test.ts`) for one release, default on. Rollback: flip the preference or revert.
- Depends on: phases 1-2. Verify: dark and light themes, all accents (amber especially), 360 dp and 412 dp widths, TalkBack on Android, 20 and 200 seeded chats.

### Phase 4: Freshness and connection honesty (M)
- Goal: no stale-but-green UI.
- Files: `src/ui/use-web-channel.ts` (pong timeout, reconnect and refresh on `visibilitychange`, expose `lastEventAt`), `src/channel/web/server.ts` (confirm it answers ping with pong; I did not read it), `src/ui/components/chat-list.tsx` (banner, retry, ticking clock), `src/ui/presentation.ts` (relative-time helper unchanged, called from a ticking parent), custom pull-to-refresh in the list.
- Tests: `test/ui/realtime.test.ts` / a hook test with a fake socket and fake timers; `test/channel/web/server.test.ts` for pong.
- Risk: medium (reconnect loops, battery). Mitigation: cap retry (already exponential, 30 s max, `use-web-channel.ts`). Rollback: revert. Depends on: nothing; can run in parallel with phase 3.
- Verify: Chrome devtools "Offline", then airplane mode on a phone, background the tab for 10 minutes, return.

### Phase 5: Quick action from the list (M)
- Goal: open straight to the pending prompt; optional inline Deny.
- Files: `src/ui/app.tsx` (`openChat` accepts a message target; `?chat=...&msg=...` deep link, also used by the push click handler in the service worker, `public/` SW file; payload already carries `chatId`), `src/ui/components/message-feed.tsx` (scroll to a prompt), row Review button; inline Deny later via `performAction`.
- Tests: `test/ui/presentation.test.ts` (target resolution), `test/channel/web/push.test.ts` (payload unchanged or extended with `promptId`), `test/channel/web/api.test.ts` for any new action param.
- Risk: medium; inline approvals are a safety decision (open question). Rollback: hide the button. Depends on: phase 3.

### Phase 6: Scale and housekeeping (M)
- Goal: bounded payload and render cost.
- Files: `src/channel/web/api.ts` (`state()` excludes archived chats; new `GET /api/chats?archived=1` or lazy load on the Archived chip), `src/channel/web/chat-log.ts` (batch the per-chat queries in `listChats`, cache previews), `src/ui/realtime.ts`, `src/ui/use-web-channel.ts`, row memoization (phase 3) plus list virtualization only if measured necessary.
- Tests: `test/channel/web/api.test.ts` (archived excluded), `test/channel/web/integration.test.ts` (resync still correct; it already mocks `listChats`, `:200`), a seeded perf test with 500 chats (soft threshold).
- Risk: medium (resync/replay correctness with archived chats). Rollback: revert. Depends on: phase 1.

### Phase 7: Search, polish, docs (S-M)
- Goal: project/cwd/preview search with highlights (client), contrast test across themes, vocabulary pass, swipe-to-archive, docs.
- Files: `src/ui/components/chat-list.tsx`, `src/ui/themes.ts`, `docs/superpowers/specs/2026-11-04-web-channel-ui-handoff.md`, `docs/web-channel-developer-guide.md`, `CONTEXT.md`, `docs/ui-critique-chat-list.md` (mark resolved items).
- Tests: `test/ui/chat-list.test.ts`, `test/ui/themes.test.ts`.
- Optional: server-side message search (FTS5) only if users ask.
- Risk: low. Depends on: phase 3.

Suggested order: 0 -> 1 -> 2 (ship: the header/list stop lying) -> 4 (parallel) -> 3 -> 5 -> 6 -> 7. Phases 0-2 are small and remove the worst problem (CL-15, CL-16) even before any redesign.

---

## 5. Open questions, unverified items, and how to measure success

### Could not verify
- Whether a Bridge restart or session end resolves pending `prompts` rows (read `notifier.ts` `endSession`, `prompts.ts`). Decides whether ended chats can carry a permanent stale prompt.
- The `prompts` table column names (only the `PromptRow` fields and a `status` filter were seen); needed if deriving from the store instead of messages.
- How often CL-21 happens in practice. It follows from the code (no pong check, no resume on visibility), but I did not test a real backgrounded PWA on Android.
- Whether `server.ts` answers client `ping` messages at all.
- Contrast ratios: no computed values for the 14 themes x 7 accents; the screenshot's dark theme looks adequate for body text, but the 9-11 px gray text is the risk.
- Real cost of `stripMarkdown` on very large messages and of `toChat` with many chats (no benchmark run).
- Whether "Session started/ended" system messages produce an unread badge in the live UI (follows from `UNREAD_KINDS`; not reproduced).
- That `navigator.setAppBadge` works in the installed PWA setup.
- I did not run `bun test` or `bun run typecheck`; baselines may already be red.

### Decisions needed from the product owner
1. Is "Done" the right word for idle-and-waiting-for-instruction, versus "Waiting for you"? (Both are "needs your attention" in different ways. I separated "Needs you" = blocked on a Prompt, "Done" = turn finished.)
2. Allow inline Deny/Allow on the list row, or always open the chat first?
3. Should General stay as the first row?
4. Should ended sessions stay under "All" (current) or only under "Ended"? Current behaviour keeps them visible until archived (`test/ui/chat-list.test.ts` "shows ended sessions until archived").
5. Is the spawned-versus-laptop distinction useful anywhere besides ending a session (`CONTEXT.md`: only Spawned Sessions can be ended)? If not, remove it from the list entirely.
6. The reminder after 30 minutes (`CONTEXT.md`) is a push only; should the row also show "waiting 30m+" escalation (e.g. stronger color)?

### Metrics and validation
Instrument minimally (a local counter table or log lines; nothing leaves the Bridge):
- **Time to answer a Prompt**: `prompts.created_at` to `answered_at` for `source = 'remote'`; target: median drops after phases 2-3. Split by "opened from push" vs "opened from the list".
- **Taps to answer from cold start**: count navigation events between app open and answer (target: 2).
- **Mis-taps**: opens of chat B within 2 s after opening chat A (back-and-forth), before and after the ordering change (CL-19).
- **Stale-state incidents**: count resyncs triggered by the new freshness check, and how often the banner shows.
- **Unread noise**: share of chats with unread > 0 whose unread messages are all lifecycle system messages (should reach 0).
- **Filter usage**: taps on "Needs you" and the strip.
- **Qualitative**: a 5-task test on a phone (find the blocked session; find the one still running; find the finished one; answer a permission; archive an ended one) with 3-5 sessions seeded, timed before and after; ask "what is this session doing right now?" for three rows and compare to ground truth.
- **Regression guard**: a unit test that every state (needs_you, working, idle, ended) produces a distinct accessible name prefix.

---

## 6. Phase 3 retrospective and Phase 3.1 plan (2026-11-10)

Evidence: the phone screenshot after Phase 3 (Android, dark, 412 dp wide, 20 sessions) and the user's feedback: "too crowded", and "Needs you" and "Working" are empty most of the time.

### 6.1 What I got wrong

| # | Claim in Phase 3 | What the screenshot shows |
|---|---|---|
| R1 | "Rows stay about the same height" | Row pitch went from about 72 dp to about 83 dp (+15%). Three lines per row (title, preview, project/draft) against two before. The list is more crowded, not less, which is the opposite of CL-8. |
| R2 | State chips make states easy to reach | In normal use Needs you and Working hold nothing, so 2 of 5 chips are dead controls most of the day. Filtering by a state that is visible in the list anyway is redundant. |
| R3 | A sticky chip bar is good | It costs about 100 dp of vertical space on every visit (header plus chips is about 17% of the screen before the first row) to offer filters that rarely apply. |
| R4 | Chips scroll, so nothing is hidden | At 412 dp the fifth chip, Archived, is cut off ("Arc"). It is reachable only if the user notices it scrolls. |
| R5 | The "N sessions need you" strip is a single, high-value cue | It duplicates the chip count and the row accent. Three signals for one state. |
| R6 | A project line on each row helps scanning | The project name is repeated in many titles ("remote-agent · 7df5fc29", "Upload Files Remote Agent / remote-agent"). On the draft row it shares a line with the draft text and collides. |
| R7 | Per-project avatar colors help | Partly true (the two purple "R" tiles are the same project) but the tile letter is the *title's* first letter, so the color and letter disagree about what identifies the row. |
| R8 | A bottom-right + is easy to reach | It was a rounded square and covers the end of the last visible row's text. (Now a circle, commit `ba1592f`.) The overlap remains: a floating button always covers something. |
| R9 | General as a normal row | General is a 3-line row with "Bridge started. Away mode is on." plus a draft. It is the least informative row and takes the most prominent spot. |

Also visible in the screenshot, not caused by Phase 3:
- "Upload Files Remote Agent" previews `You: This session is being continued from a previous con…`. That is a compaction summary stored *before* commit `d0bf171`; the fix stops new ones, old messages stay.
- An emoji inside a preview (`Ended · ❌ Session did not start…`) is visual noise at 12 px.

What worked: previews are clean plain text, the bottom of the screen is calm now that the footer is silent, same-project rows share a color, and nothing in the list is smaller than 12 px.

### 6.2 Direction (the user's proposal, refined)

Replace the filter chips with **groups in the list**, each with a header that exists only when it has rows:

```
+--------------------------------------------+
| ( Search sessions                  )  (gear)|
+--------------------------------------------+
|  [⌘] General                            5m |   compact, one line
+--------------------------------------------+
|  NEEDS YOU  1                              |   amber, only when non-empty
|  [R] Billing fix                        now|
|      Permission: Bash: bun test            |
+--------------------------------------------+
|  WORKING  1                                |   only when non-empty
|  [U] Upload Files                        2m|
|      Working · Running Bash: bun test      |
+--------------------------------------------+
|  LATEST                                    |
|  [A] Address Explore Cabinet           6h  |
|      I don't know which screen you mean…   |
|  ...                                       |
|  Archived  3  >                            |   quiet link at the end of the list
+--------------------------------------------+
                                        ( + )
```

Why groups beat chips: an empty group costs zero pixels; a non-empty one is the only thing at the top and says what it is. The strip, the chip bar and the chip counts all go away (R2, R3, R4, R5), and about 100 dp of height comes back.

Suggestions beyond the proposal:
1. **Two lines per row, not three** (R1, R6). Title and time; then the preview (with its state prefix). The project is not printed on the row: it lives in the avatar and in search/details.
2. **Avatar letter = project initial** (R7), same project color. Title still identifies the session. General keeps ⌘.
3. **Draft is an icon, not text**: a small pencil next to the time. The draft text is shown inside the chat. This removes the line that collided with the project (R6).
4. **General is compact** (R9): one line, no preview. It keeps its unread dot and pencil.
5. **Search shows a flat list** (no group headers) so results are not split into sections.
6. **Archived** moves to a quiet "Archived · n" row at the end of the list that opens the archived list with a back control. Ended sessions stay in Latest, dimmed with the "Ended ·" prefix, unless the user prefers them in their own collapsed group.
7. **Keep what worked**: the state dot on the avatar, the amber `--status-needs` token, state-first accessible names, plain-text previews, the silent footer, the circular +.

### 6.3 Phase 3.1 plan

Small, in two commits; no data-model change.

1. **Grouping (pure logic, test first).** New `groupChats(chats, query)` in `src/ui/chat-filters.ts` returning `[{ key: 'needs_you' | 'working' | 'latest', label, chats }]`: empty groups omitted, order inside a group is the shared `orderChats`, General handled separately, a non-empty query returns one flat group. Delete `ListFilter` and `filterCounts`; keep an `archived` view toggle. Tests: `test/ui/chat-filters.test.ts` (groups, empty omitted, ended in latest, query flat, General separate).
2. **List UI.** Remove `ChatFilterBar` and the strip from `chat-list.tsx`. Render group headers (12 px, semibold; Needs you uses `text-status-needs`; counts only in Needs you/Working). Add the "Archived · n" end row and a back state. Keep selection mode (ended sessions only) and the scroll-bottom padding for the +.
3. **Row UI.** `chat-row.tsx`: drop the meta line, pencil icon for drafts, project initial for the tile, compact General. Keep the accessible name (it already includes project and draft). Update `test/ui/chat-state-surfaces.test.tsx` (no project text in rows, group headers present only when non-empty, archived link, General one line).
4. **One-off data cleanup (needs the user's OK).** Delete stored compaction-summary user messages already in chat logs so "You: This session is being continued…" stops showing. Small SQL by message text prefix, run on a copy first.
5. **Docs and cache.** Bump the service worker cache; note the grouping in the developer guide only if it mentions the list tabs (it does not).

Verification: `bun test`, `bun run typecheck`, `bun run build`, then the phone. Rollback: revert the two commits.

Size: S to M. Risk: low (UI only). Depends on: nothing.

### 6.4 Decisions needed (defaults in bold)
1. Ended sessions: **stay in Latest, dimmed** / own collapsed "Ended" group.
2. Tile letter: **project initial** / title initial.
3. Project name text on the row: **dropped** / kept as a small suffix.
4. Delete old compaction-summary messages from existing chats: **yes** / leave them.

---

## 7. Pin sessions (done 2026-11-10)

Asked for by the user on 2026-11-10: "I want ability to pin but it's lower priority."

**Today.** `Chat.pinned` exists but only General is ever pinned; `updateChat` cannot set it (`chat-log.ts`), and there is no chat-pin endpoint (only message pins, `PinSchema`). The row no longer shows a pin glyph (removed in Phase 3, CL-10).

**What it needs**
1. **Server.** `ChatLog.setChatPinned(id, pinned)` emitting `chat.updated`; `PUT /api/chats/:id/pin { pinned }` (400 for General and unknown chats; General stays pinned); tests in `test/channel/web/chat-log.test.ts` and `api.test.ts`; document in the developer guide and handoff.
2. **Ordering.** A pinned chat ranks above the "latest" group. One shared rule in `src/channel/web/order.ts` (see the open question below), with tests in `order.test.ts`.
3. **UI.** A way to pin and unpin: a "Pin" action in the chat details panel (already has Archive and Rename) and in the row's long-press menu; a small pin mark on pinned rows; accessible name includes "pinned". Pinned rows appear in All, and in a tab only if they match it.
4. **Limits.** Optional cap (for example 5 pins) so pinning cannot recreate a crowded list.
5. **Ended and archived chats.** A pinned chat that ends moves to the Ended tab like any other; archiving unpins it.

**Open question: where do pins rank?** The list order now is General, then chats that need you, then chats with a draft (newest edit first), then working, then the rest by latest message. Recommendation: pinned chats (by latest message) go right after the ones that need you, so the order becomes General, needs you, pinned, drafts, working, latest. Pins then never bury a blocked session. If the user wants pins above blocked sessions, it is a one-line change in `order.ts`.

Size: S to M. Risk: low. Depends on: nothing. Priority: P2.

**Done as recommended:** order is General, needs you, pinned, drafts, working, latest. At most 5 pins; archiving unpins; an archived session cannot be pinned; ended sessions are not ranked as pinned. The pin action is in the details panel (Pin to top / Unpin Session) and a pinned row shows a small pin. The row's long-press menu was not added, because long-press already starts selection for archiving ended sessions.
