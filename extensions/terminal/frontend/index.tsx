import { registerPanel } from '../../../src/ui/components/extension-registry.tsx'
import { registerChatAction, registerDashboardCard, registerSidebarSection } from '../../../src/ui/extension-slots.ts'
import { TerminalPanelHost } from './TerminalPanel.tsx'
import { TerminalChatAction, TerminalsDashboardCard, TerminalsSidebarSection } from './surfaces.tsx'

/** Everything the terminal extension adds to the host. The host renders these without knowing what they are. */
registerPanel('terminal', TerminalPanelHost, 'Terminal')
registerSidebarSection('terminal', context => <TerminalsSidebarSection {...context} />)
registerDashboardCard('terminal', context => <TerminalsDashboardCard {...context} />)
registerChatAction('terminal', context => <TerminalChatAction {...context} />)
