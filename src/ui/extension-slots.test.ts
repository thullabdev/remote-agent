import { beforeEach, expect, test } from 'bun:test'
import { chatInfoSections, clearSlotsForTesting, registerChatInfoSection } from './extension-slots.ts'

beforeEach(() => clearSlotsForTesting())

test('each registration is its own section, in registration order', () => {
  registerChatInfoSection('a', 'File changes', () => null)
  registerChatInfoSection('b', 'Notes', () => null)
  expect(chatInfoSections().map(s => [s.id, s.title])).toEqual([['a', 'File changes'], ['b', 'Notes']])
})

test('registering the same id again replaces that section and keeps its place', () => {
  registerChatInfoSection('a', 'First', () => null)
  registerChatInfoSection('b', 'Second', () => null)
  registerChatInfoSection('a', 'First again', () => null)
  expect(chatInfoSections().map(s => [s.id, s.title])).toEqual([['a', 'First again'], ['b', 'Second']])
})
