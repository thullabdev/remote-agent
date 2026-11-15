import { registerPanel } from '../../../src/ui/components/extension-registry.tsx'
import { TerminalPanel } from './TerminalPanel.tsx'

registerPanel('terminal', TerminalPanel, 'Terminal')
