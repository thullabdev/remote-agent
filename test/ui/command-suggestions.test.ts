import { describe, expect, test } from 'bun:test'
import { GENERAL_COMMANDS, insertCommand, matchingCommands, moveCommandSelection, slashCommandQuery } from '../../src/ui/command-suggestions.ts'

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
