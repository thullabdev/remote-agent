import { describe, expect, it } from 'bun:test'
import { CHATS_TAB, readSideTab, saveSideTab } from '../../src/ui/components/side-panel/side-tab.ts'

function storageWith(value: string | null) {
  return { getItem: () => value, setItem: () => {} }
}

describe('readSideTab', () => {
  const known = ['terminal']

  it('returns the remembered tab when it is still registered', () => {
    expect(readSideTab(known, storageWith('"terminal"'))).toBe('terminal')
  })

  it('returns Chats when the remembered tab is no longer registered', () => {
    expect(readSideTab(known, storageWith('"gone"'))).toBe(CHATS_TAB)
  })

  it('returns Chats when nothing is stored, the JSON is bad, or the value is not a string', () => {
    expect(readSideTab(known, storageWith(null))).toBe(CHATS_TAB)
    expect(readSideTab(known, storageWith('{not json'))).toBe(CHATS_TAB)
    expect(readSideTab(known, storageWith('42'))).toBe(CHATS_TAB)
  })

  it('returns Chats when storage throws', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked')
      },
    }
    expect(readSideTab(known, broken)).toBe(CHATS_TAB)
  })
})

describe('saveSideTab', () => {
  it('stores the tab id as JSON under the side tab key', () => {
    const written: Array<[string, string]> = []
    saveSideTab('terminal', { setItem: (key, value) => written.push([key, value]) })

    expect(written).toEqual([['remote-agent.side-tab.v1', '"terminal"']])
  })
})
