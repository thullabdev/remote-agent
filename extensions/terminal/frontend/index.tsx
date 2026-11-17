import { Terminal } from 'lucide-react'
import { registerChatAction, registerDashboardCard, registerSideTab } from '../../../src/ui/extension-slots.ts'
import { TERMINAL_TAB } from './actions.ts'
import { TerminalsSideTab } from './TerminalPanel.tsx'
import { TerminalChatAction, TerminalsDashboardCard } from './surfaces.tsx'

/**
 * Everything the terminal extension adds to the host. The host renders these without knowing what they are.
 * The terminal is a side tab only: its shells and emulator live in the side column, not in the main area.
 */
registerSideTab(TERMINAL_TAB, { title: 'Terminals', icon: Terminal, render: context => <TerminalsSideTab {...context} /> })
registerDashboardCard('terminal', context => <TerminalsDashboardCard {...context} />)
registerChatAction('terminal', context => <TerminalChatAction {...context} />)
