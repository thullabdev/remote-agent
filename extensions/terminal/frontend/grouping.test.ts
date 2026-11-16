import { describe, it, expect } from 'bun:test'
import { groupByFolder, openSessionInFolder, projectName, sameFolder, terminalLabel } from './grouping.ts'

describe('groupByFolder', () => {
  it('groups by launch folder, newest group first, newest session first inside it', () => {
    const groups = groupByFolder([
      { id: 'a1', cwd: '/home/me/app', createdAt: 10 },
      { id: 'b1', cwd: '/home/me/api', createdAt: 50 },
      { id: 'a2', cwd: '/home/me/app', createdAt: 40 },
    ])

    expect(groups.map(group => group.cwd)).toEqual(['/home/me/api', '/home/me/app'])
    expect(groups[1]?.sessions.map(s => s.id)).toEqual(['a2', 'a1'])
  })

  it('keeps two folders with the same project name apart', () => {
    const groups = groupByFolder([
      { id: 'x', cwd: '/work/app', createdAt: 1 },
      { id: 'y', cwd: '/home/app', createdAt: 2 },
    ])

    expect(groups.map(group => group.project)).toEqual(['app', 'app'])
    expect(groups.map(group => group.cwd)).toEqual(['/home/app', '/work/app'])
  })

  it('names the project after the last folder segment', () => {
    expect(projectName('/home/me/projects/app/')).toBe('app')
    expect(projectName('/')).toBe('/')
    expect(groupByFolder([{ id: 'r', cwd: '/', createdAt: 1 }])[0]?.project).toBe('/')
  })

  it('returns no groups for no sessions', () => {
    expect(groupByFolder([])).toEqual([])
  })
})

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
