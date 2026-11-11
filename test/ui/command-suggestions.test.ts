import { describe, expect, test } from 'bun:test'
import { applySuggestion, argumentSuggestions, GENERAL_COMMANDS, insertCommand, matchingCommands, moveCommandSelection, slashCommandQuery } from '../../src/ui/command-suggestions.ts'

describe('chat command suggestions', () => {
  test('matches only supported commands at the end of a word in General', () => {
    expect(slashCommandQuery('hello /st')).toBe('st')
    expect(matchingCommands('st', true).map(command => command.name)).toEqual(['status'])
    expect(matchingCommands('', true).map(command => command.name)).toEqual(GENERAL_COMMANDS.map(command => command.name))
    expect(matchingCommands('sta', false)).toEqual([])
    expect(matchingCommands('mod', true)).toEqual([])
    expect(slashCommandQuery('hello/status')).toBeNull()
    expect(slashCommandQuery('/status arg')).toBeNull()
  })

  test('cycles keyboard selection in both directions and completes the current token', () => {
    expect(moveCommandSelection(0, 4, -1)).toBe(3)
    expect(moveCommandSelection(3, 4, 1)).toBe(0)
    expect(moveCommandSelection(0, 0, 1)).toBe(0)
    expect(insertCommand('Please /sta', 'status')).toBe('Please /status ')
    expect(insertCommand('/new project', 'new')).toBe('/new project')
  })
})

test('after /new a dash offers the flags, and a bare space offers them all', () => {
  expect(argumentSuggestions('/new -', true)?.map(item => item.name)).toEqual(['--resume', '--model'])
  expect(argumentSuggestions('/new --m', true)?.map(item => item.name)).toEqual(['--model'])
  expect(argumentSuggestions('/new ', true)?.map(item => item.name)).toEqual(['--resume', '--model'])
  expect(argumentSuggestions('/new /home/u/app -', true)?.map(item => item.name)).toEqual(['--resume', '--model'])
})

test('after --model or -m the model names are offered, filtered by what is typed', () => {
  expect(argumentSuggestions('/new --model ', true)?.map(item => item.name)).toEqual(['opus', 'sonnet', 'haiku', 'opusplan'])
  expect(argumentSuggestions('/new --model so', true)?.map(item => item.name)).toEqual(['sonnet'])
  expect(argumentSuggestions('/new -m h', true)?.map(item => item.name)).toEqual(['haiku'])
})

test('no argument suggestions outside General, after a folder is typed, or for other commands', () => {
  expect(argumentSuggestions('/new -', false)).toBeNull()
  expect(argumentSuggestions('/new ~/app', true)).toBeNull()
  expect(argumentSuggestions('/new', true)).toBeNull()
  expect(argumentSuggestions('/status -', true)).toBeNull()
  expect(argumentSuggestions('hello -', true)).toBeNull()
})

test('a chosen flag or model replaces the word typed and leaves a space for the next word', () => {
  expect(applySuggestion('/new --m', { name: '--model', description: '', kind: 'flag' })).toBe('/new --model ')
  expect(applySuggestion('/new --model ', { name: 'haiku', description: '', kind: 'value' })).toBe('/new --model haiku ')
  expect(applySuggestion('/new ', { name: '--resume', description: '', kind: 'flag' })).toBe('/new --resume ')
  expect(applySuggestion('/ne', { name: 'new', description: '' })).toBe('/new ')
})
