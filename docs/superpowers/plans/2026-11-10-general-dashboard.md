# General Dashboard ("Mission Control") — Plan

**Status:** plan only, not implemented. Implementation goes on a new branch cut from `feat/chat-list-revamp` (e.g. `feat/general-dashboard`).

## Goal

General is the first and most-visited screen, yet it is a plain command chat. Turn it into a **home screen**: glance at it and know what needs you, what is running, how much budget is left, and what to do next. The command chat stays, one tap away.

## Non-goals

- No new chat types, no change to how Spawned Sessions or the mod work.
- No history analytics beyond the last 7 days (no charts library, no export).
- Telegram is unaffected; General's command handling (`/status`, `/new`, `/away`, `/back`) is unchanged.

## Decisions (assumptions to review)

1. **The dashboard replaces General's feed as the default view**, with a `Dashboard | Chat` switch in the header. Opening General shows the dashboard; the choice is remembered per device (`preferences`).
2. **Command box stays pinned at the bottom of the dashboard.** Sending a command switches to the Chat view so the reply is visible.
3. **Phase 1 uses only data the client already has** (`Chat[]`, `UsageView`, `away`). No backend change. Phases 2–3 add small server pieces.
4. **Quick answers are limited to permission prompts** (Allow / Deny). Questions need their options, which `PendingPrompt` does not carry, so a question card opens the chat at the prompt.
5. **Desktop and phone share one layout** that reflows: single column on phones, two columns from `md`.

## Current state (what exists)

| Need | Where it already lives |
|---|---|
| Chats, state, pending prompt | `Chat`, `PendingPrompt` in `src/channel/web/protocol.ts`; `chatState()` in `chat-state.ts` |
| Live updates | `chat.updated` events via `use-web-channel.ts` |
| Usage / limits | `UsageView` (`accounts[].windows[]`, `chats[id]`), `usage.updated`; formatting in `usage-format.ts`, meters in `usage-meters.tsx` |
| Answer a permission | `api.performAction(chatId, { promptId, questionIndex: 0, optionIndex: 0 \| 1 })` (0 = Allow, 1 = Deny), used by the feed's permission card |
| Away mode | `realtime.away`, `api.setAway` |
| New session | `new-session-dialog.tsx`, project list `api.getProjects()` |
| Resume / pin / archive | `api.resumeChat`, `api.pinChat`, `api.archiveChat` |
| General-specific bits | `chat-header.tsx` (⌘ avatar, subtitle), `message-feed.tsx` empty state, `chatAvatar()` |

What is missing: the **current step** of a working session (only `lastMessage.preview`), **per-day activity**, and **a recent-events feed**.

## Design

### Layout (top to bottom)

1. **Greeting strip** — "Your computer is online · 3 live sessions", with the Away toggle inline. States: all quiet / needs you (accent) / away.
2. **Needs you** — one card per session with a `pendingPrompt`, oldest first. Shows project, summary, "waiting 4m" (from `pendingPrompt.at`). Permission: **Allow / Deny** buttons. Question: **Answer** (opens the chat at the prompt). Hidden when empty.
3. **Working now** — one compact card per working session: project, session name, current step, elapsed, pulsing dot. Tap opens the session. Hidden when empty.
4. **Budget** — rings or meters per account window (reuse `usage-meters` data and `formatLimitReset`), plus the busiest session's context %. Replaces the account-limit view removed from the details panel.
5. **Quick actions** — `New session` (project chips for the 3 most recent projects), `Resume last ended`, `Open computer sessions` (applies the origin filter on the list).
6. **Today** *(phase 2)* — sessions started, tasks finished, time Claude worked, 7-day sparkline.
7. **Recent activity** *(phase 2)* — last ~8 events: finished, failed, started, ended. Each opens its session.
8. **Projects grid** *(phase 3)* — one tile per project: live count, last activity.
9. **Composer** — the existing composer, pinned.

Empty state (nothing live): the greeting plus Quick actions, so the screen is never blank.

### Components (all under `src/ui/components/dashboard/`)

- `dashboard.tsx` — composes sections; receives `chats`, `usage`, `away`, callbacks.
- `needs-you-card.tsx`, `working-card.tsx`, `budget-card.tsx`, `quick-actions.tsx`, `greeting-strip.tsx`; later `today-card.tsx`, `activity-feed.tsx`, `projects-grid.tsx`.
- `src/ui/dashboard-model.ts` — **pure functions** that derive section data from `Chat[]`/`UsageView` (sort, counts, wait time, recent projects). All logic lives here so it is testable without React.

### Wiring

- `app.tsx`: when `activeChat.id === 'general'` and view is `dashboard`, render `<Dashboard />` instead of `MessageFeed`; keep `ChatComposer`. Header gets the `Dashboard | Chat` segmented switch (General only).
- `preferences.ts`: `generalView: 'dashboard' | 'chat'` (default `'dashboard'`).
- `chat-header.tsx`: General subtitle becomes a live summary ("2 need you · 3 working") instead of "General command chat".
- `chat-row.tsx`: General's row preview shows the same summary when there is no last message of interest, so the list also hints at what the dashboard holds.

## Phases

### Phase 1 — Home from existing data (no backend change)

Scope: greeting strip, Needs you (Allow/Deny), Working now (using `lastMessage.preview` as the step for now), Budget, Quick actions, view switch + preference, General header subtitle.

Tasks:
1. `dashboard-model.ts` + tests (see Testing).
2. Section components with SSR markup tests.
3. `Dashboard` composition, view switch, preference, `app.tsx` wiring.
4. Allow/Deny from the card: reuse `onAction`; optimistic "Allowed/Denied" state like the feed card; errors via `handleError`.
5. Accessibility: sections are `<section aria-labelledby>`, cards are real buttons/links, live region (`aria-live="polite"`) for the greeting summary only (not every card).
6. Rebuild, bump `public/sw.js` cache, restart service.

Done when: General opens to the dashboard; a permission request raised in any session shows on it within a second and can be answered from it; usage meters match the details of the header panel; switching to Chat shows the old command feed; no regressions (`bun test`, `bunx tsc --noEmit`).

### Phase 2 — Current step, Today, Recent activity (small backend)

- **Current step:** add `activity: { tool: string; summary: string; at: number } | null` to `Chat`, set from the newest `tool_run` message with `status: 'running'` (in `ChatLog`, via the existing `CHAT_SELECT`/message path; cleared when the turn ends). Update `protocol.ts`, `chat-log` tests, and the developer guide.
- **Today / activity:** new `GET /api/activity?days=7` returning `{ days: [{ date, sessionsStarted, tasksFinished, workedMs }], recent: [{ at, chatId, kind, label }] }`, computed in SQL from `messages`/`chats` (`tasksFinished` = completed turns; `workedMs` = sum of busy intervals, approximated from `tool_run.durationMs` plus turn spans). Cache for 30 s. Needs a timezone parameter (`tz` offset) so "today" matches the user.
- UI: `today-card.tsx` (stats + sparkline as inline SVG, no library), `activity-feed.tsx`.
- Open question: is "tasks finished" reliably derivable? If not, show **turns completed** and say so in the label.

### Phase 3 — Projects grid and polish

- Project tiles grouped by `chat.project`, with live count, last activity, one-tap "New session here".
- Optional 7-day heatmap, greeting variants, and the glow on the General avatar when something needs you.

## Testing

- **`dashboard-model` unit tests:** ordering (oldest prompt first), wait-time formatting, working vs needs-you exclusivity (needs-you wins, as `chatState` does), archived/ended excluded, recent-projects dedup and cap, empty states, General excluded from its own cards.
- **SSR markup tests** per component, following existing patterns (mind escaped apostrophes and `&amp;` in class selectors).
- **Interaction:** Allow/Deny calls `onAction` with `optionIndex` 0/1 and the card's `promptId`; Question card calls `onOpenChat(chatId)`.
- **Preference:** default is `dashboard`; the stored value round-trips; an invalid stored value falls back.
- **Phase 2:** `ChatLog` activity field tests; `/api/activity` aggregation tests with a fixed clock and a timezone offset case.
- Every phase ends with `bun test >log 2>&1; echo "exit $?"` and `bunx tsc --noEmit` clean.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Allow from a card approves something the user did not read | The card shows the full `pendingPrompt.summary` (tool and command), not a truncated label; a long summary wraps, never clips. Allow keeps the same single-tap behaviour as the feed card. |
| Dashboard hides the command chat people use | Header switch is always visible; sending from the composer jumps to Chat; the preference remembers the choice. |
| Stale cards after a reconnect | Derived purely from `chats`, which already resyncs; show the existing connection banner state, and disable Allow/Deny while offline. |
| Phase 2 stats are wrong or slow | Computed server-side, cached, labelled by what they truly count; Phase 1 ships without them. |
| Visual regressions are not verifiable here (no headless browser) | Markup tests plus user review on the phone after each phase. |

## Open questions for review

1. Dashboard as default, or Chat as default with the dashboard one tap away?
2. Should the Budget card show every account window or only the closest-to-limit one?
3. Is "Resume last ended" worth a slot, or too easy to hit by mistake?
4. Phase 2: acceptable to label it "turns completed" if tasks cannot be derived exactly?

## Docs to update when implemented

- `docs/web-channel-developer-guide.md` (new `Chat.activity` field and `/api/activity` route in Phase 2).
- This plan: mark each phase done with its commit.
