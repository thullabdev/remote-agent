import { registerPanel } from '../../../src/ui/components/extension-registry.tsx'
import { Terminal } from 'lucide-react'
import { registerChatAction, registerDashboardCard, registerSideTab } from '../../../src/ui/extension-slots.ts'
import { TerminalPanelHost } from './TerminalPanel.tsx'
import { TerminalChatAction, TerminalsDashboardCard, TerminalsSideTab } from './surfaces.tsx'

/** Everything the terminal extension adds to the host. The host renders these without knowing what they are. */
registerPanel('terminal', TerminalPanelHost, 'Terminal')
registerSideTab('terminal', { title: 'Terminals', icon: Terminal, render: context => <TerminalsSideTab {...context} /> })
registerDashboardCard('terminal', context => <TerminalsDashboardCard {...context} />)
registerChatAction('terminal', context => <TerminalChatAction {...context} />)
