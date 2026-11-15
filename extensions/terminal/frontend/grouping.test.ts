import { describe, it, expect } from 'bun:test'
import { groupByFolder, projectName } from './grouping.ts'

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
