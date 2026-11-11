import { expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Chat, PinView } from '../../src/channel/web/protocol.ts'
import { ChatInfo } from '../../src/ui/components/chat-info.tsx'

const chat: Chat = {
  id: 'c1', title: 'Billing fix', project: 'api', cwd: '/home/u/api', status: 'active', spawned: false, archived: false,
  busy: false, unread: 0, lastMessage: null, draft: null, pinned: false, tmuxName: null, pendingPrompt: null, activity: null,
}

function render(pins: PinView[] = [], shown: Chat = chat): string {
  return renderToStaticMarkup(createElement(ChatInfo, {
    chat: shown,
    onClose: () => {},
    onNotify: () => {},
    onEnd: async () => {},
    onArchive: async () => {},
    onUnarchive: async () => {},
    onRename: async () => {},
    onPin: async () => {},
    onClear: async () => {},
    onFork: async () => {},
    onResume: async () => {},
    pins,
    onUnpin: async () => {},
    onJump: () => {},
  }))
}

const ended: Chat = { ...chat, status: 'ended' }

test('bookmarks are called bookmarks, so they are not confused with pinning a session', () => {
  const markup = render()
  expect(markup).toContain('Bookmarks · 0')
  expect(markup).toContain('Tap the bookmark on a message to keep it here.')
  expect(markup).not.toContain('Pinned messages')
  expect(markup).not.toContain('Refresh pinned messages')
})

test('each bookmark shows its author, preview and actions', () => {
  const markup = render([
    { id: 'm_1', seq: 3, at: Date.UTC(2026, 10, 8, 9, 0), kind: 'agent_text', preview: 'Plan: split the migration' },
    { id: 'm_2', seq: 5, at: Date.UTC(2026, 10, 8, 9, 5), kind: 'user_text', preview: 'Use staging' },
  ])
  expect(markup).toContain('Bookmarks · 2')
  expect(markup).toContain('Plan: split the migration')
  expect(markup).toContain('Agent')
  expect(markup).toContain('Use staging')
  expect(markup).toContain('Show in chat')
  expect(markup).toContain('Remove bookmark')
})

test('the details offer to pin a session to the top, and to unpin a pinned one', () => {
  expect(render()).toContain('Pin to top')
  expect(render()).not.toContain('>Unpin<')
  const pinned = render([], { ...chat, pinned: true })
  expect(pinned).toContain('>Unpin<')
  expect(pinned).not.toContain('Pin to top')
})

test('General and archived sessions have no pin action', () => {
  expect(render([], { ...chat, id: 'general', title: 'General', project: null, pinned: true })).not.toMatch(/Pin to top|>Unpin</)
  expect(render([], { ...ended, archived: true })).not.toMatch(/Pin to top|>Unpin</)
})

test('the state badge uses the list wording, never the raw status', () => {
  expect(render()).toContain('>Idle<')
  expect(render()).not.toContain('>active<')
  expect(render([], ended)).toContain('>Ended<')
  expect(render([], { ...chat, busy: true })).toContain('>Working<')
  expect(render([], { ...chat, pendingPrompt: { promptId: 'p', kind: 'permission', summary: 'Bash: ls', at: 1, count: 1 } })).toContain('>Needs you<')
})

test('the source line says computer or spawned, and General has none', () => {
  expect(render()).toContain('data-origin="computer"')
  expect(render()).toContain('Running on your computer')
  expect(render([], { ...chat, spawned: true })).toContain('Spawned by Remote Agent')
  expect(render([], { ...chat, id: 'general', title: 'General', project: null, cwd: null })).not.toContain('data-origin')
})

test('empty details are hidden instead of saying not available', () => {
  const markup = render([], { ...chat, project: null, cwd: null })
  expect(markup).not.toContain('Not available')
  expect(markup).not.toContain('Project')
  expect(markup).not.toContain('Technical')
})

test('details no longer repeat usage or a loaded-message count', () => {
  const markup = render()
  expect(markup).not.toContain('Account limits')
  expect(markup).not.toContain('Cost $')
  expect(markup).not.toContain('Messages')
})

test('the primary action is Resume for an ended session and Fork for a live one', () => {
  expect(render()).toContain('Fork')
  expect(render()).not.toContain('Resume')
  const markup = render([], ended)
  expect(markup).toContain('Resume')
  expect(markup).toContain('Starts Claude again with this session&#x27;s history.')
  expect(markup).not.toContain('>Fork<')
})

test('technical details hold the directory and a copyable tmux command, without the spawned-only note', () => {
  const markup = render([], { ...chat, spawned: true, tmuxName: 'ra-1' })
  expect(markup).toContain('tmux attach -t ra-1')
  expect(markup).toContain('aria-label="Copy attach command"')
  expect(markup).toContain('aria-label="Copy working directory"')
  expect(markup).not.toContain('Spawned Sessions only')
})

test('management actions: archive and restore run at once, and hiding history is named for what it does', () => {
  const live = render()
  expect(live).toContain('Hide history on all devices')
  expect(live).not.toContain('Clear chat history')
  expect(live).not.toContain('>Archive<')
  expect(render([], ended)).toContain('>Archive<')
  expect(render([], { ...ended, archived: true })).toContain('Restore from Archived')
  expect(render([], { ...chat, spawned: true })).toContain('End Spawned Session')
})

test('the panel is labelled for assistive technology', () => {
  expect(render()).toContain('aria-label="Session details"')
})
