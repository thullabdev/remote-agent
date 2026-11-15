import { expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Chat, PinView } from '../../src/channel/web/protocol.ts'
import { ChatHeader } from '../../src/ui/components/chat-header.tsx'
import { ChatInfo } from '../../src/ui/components/chat-info.tsx'
import { modelLabel } from '../../src/ui/presentation.ts'

const chat: Chat = {
  id: 'c1', title: 'Billing fix', project: 'api', cwd: '/home/u/api', status: 'active', spawned: false, archived: false,
  busy: false, unread: 0, lastMessage: null, draft: null, pinned: false, tmuxName: null, pendingPrompt: null, activity: null,
}

test('modelLabel shortens a full id to family and version, and keeps anything it does not recognise', () => {
  expect(modelLabel('claude-opus-5-5')).toBe('Opus 5.5')
  expect(modelLabel('claude-sonnet-5-5')).toBe('Sonnet 5.5')
  expect(modelLabel('claude-sonnet-4-5-20250929')).toBe('Sonnet 4.5')
  expect(modelLabel('claude-haiku-5')).toBe('Haiku 5')
  expect(modelLabel('gpt-5')).toBe('gpt-5')
})

function header(model: string | null): string {
  return renderToStaticMarkup(createElement(ChatHeader, {
    chat, status: 'connected', onBack: () => {}, onInfo: () => {}, infoOpen: false, onRename: async () => {}, model,
  }))
}

test('the header shows the model as a short label, with the full id on hover', () => {
  const markup = header('claude-opus-5-5')
  expect(markup).toContain('>Opus 5.5</span>')
  expect(markup).toContain('title="Model: claude-opus-5-5"')
  expect(markup).toContain('Billing fix')
})

test('the header shows no model chip while the model is unknown', () => {
  expect(header(null)).not.toContain('Opus')
  expect(header(null)).not.toContain('Model:')
})

function info(model: string | null): string {
  return renderToStaticMarkup(createElement(ChatInfo, {
    chat, onClose: () => {}, onNotify: () => {}, onEnd: async () => {}, onArchive: async () => {}, onUnarchive: async () => {},
    onRename: async () => {}, onPin: async () => {}, onClear: async () => {}, onFork: async () => {}, onResume: async () => {},
    pins: [] as PinView[], onUnpin: async () => {}, onJump: () => {}, model,
    api: { subagentActivity: async () => ({ items: [], nextCursor: null }) }, subagent: null, onCloseSubagent: () => {},
  }))
}

test('the details panel lists the full model id, and no Model row while it is unknown', () => {
  expect(info('claude-opus-5-5')).toContain('claude-opus-5-5')
  expect(info('claude-opus-5-5')).toContain('>Model<')
  expect(info(null)).not.toContain('>Model<')
})
