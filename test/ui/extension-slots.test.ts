import { beforeEach, describe, expect, it } from 'bun:test'
import { clearSlotsForTesting, registerSideTab, sideTabRender, sideTabs, type SideTabContext } from '../../src/ui/extension-slots.ts'

const context: SideTabContext = { activeChat: null, openPanel: () => {}, notify: () => {}, density: 'comfortable' }
const Icon = () => null

describe('side tabs', () => {
  beforeEach(() => {
    clearSlotsForTesting()
  })

  it('lists registered tabs in registration order with their ids', () => {
    registerSideTab('a', { title: 'A', icon: Icon, render: () => 'a' })
    registerSideTab('b', { title: 'B', icon: Icon, render: () => 'b' })

    expect(sideTabs().map(tab => [tab.id, tab.title])).toEqual([
      ['a', 'A'],
      ['b', 'B'],
    ])
  })

  it('replaces a tab registered again under the same id', () => {
    registerSideTab('a', { title: 'A', icon: Icon, render: () => 'old' })
    registerSideTab('a', { title: 'A2', icon: Icon, render: () => 'new' })

    expect(sideTabs()).toHaveLength(1)
    expect(sideTabs()[0]?.title).toBe('A2')
  })

  it('renders a tab with the context, and nothing for an unknown id', () => {
    registerSideTab('a', { title: 'A', icon: Icon, render: tabContext => `chat:${tabContext.activeChat === null ? 'none' : 'open'}` })

    expect(sideTabRender('a', context)).toBe('chat:none')
    expect(sideTabRender('missing', context)).toBeNull()
  })
})
