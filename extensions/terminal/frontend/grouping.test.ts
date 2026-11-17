import { describe, it, expect } from 'bun:test'
import { openSessionInFolder, projectName, sameFolder, tabLabel, terminalLabel } from './grouping.ts'

describe('sameFolder', () => {
  it('treats a trailing slash as the same folder', () => {
    expect(sameFolder('/home/me/app/', '/home/me/app')).toBe(true)
  })

  it('treats different folders as different, even with a shared name', () => {
    expect(sameFolder('/home/me/app', '/work/app')).toBe(false)
  })

  it('keeps the root as the root', () => {
    expect(sameFolder('/', '/')).toBe(true)
    expect(sameFolder('/', '/home')).toBe(false)
  })
})

describe('openSessionInFolder', () => {
  it('returns the newest session in the folder, and ignores other folders', () => {
    const sessions = [
      { sid: 'b-new', cwd: '/work/b' },
      { sid: 'a-new', cwd: '/home/me/app/' },
      { sid: 'a-old', cwd: '/home/me/app' },
    ]

    expect(openSessionInFolder(sessions, '/home/me/app')?.sid).toBe('a-new')
  })

  it('returns undefined when no session is in the folder', () => {
    expect(openSessionInFolder([{ sid: 'x', cwd: '/elsewhere' }], '/home/me/app')).toBeUndefined()
  })
})

describe('terminalLabel', () => {
  it('names a shell by its start time, not by its id', () => {
    const label = terminalLabel({ createdAt: new Date(2026, 10, 15, 14, 32).getTime() })
    expect(label).toMatch(/^Shell · \d{2}:32$|^Shell · \d{1,2}:32/)
    expect(label).not.toContain('term-')
  })

  it('falls back to a plain name when the start time is unknown', () => {
    expect(terminalLabel({})).toBe('Shell')
  })
})

describe('tabLabel', () => {
  it('shows the last folder and the foreground command', () => {
    expect(tabLabel({ cwd: '/work/api', command: 'vim' })).toBe('api • vim')
  })

  it('shows the shell name while idle, since the shell is then the foreground command', () => {
    expect(tabLabel({ cwd: '/work/api/', command: 'zsh' })).toBe('api • zsh')
  })

  it('shows only the folder when the command is unknown', () => {
    expect(tabLabel({ cwd: '/work/api', command: null })).toBe('api')
    expect(tabLabel({ cwd: '/work/api' })).toBe('api')
  })
})
