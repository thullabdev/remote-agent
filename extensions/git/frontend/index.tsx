import { GitBranch } from 'lucide-react'
import { registerChatInfoSection, registerSideTab } from '../../../src/ui/extension-slots.ts'
import { registerPanel } from '../../../src/ui/components/extension-registry.tsx'
import { ChangedFilesSection } from './ChangedFilesSection.tsx'
import { DiffPanel } from './DiffPanel.tsx'
import { GitSideTab } from './GitSideTab.tsx'

/** Everything the git extension adds to the host. The host renders these without knowing what they are. */
registerSideTab('git', { title: 'Git', icon: GitBranch, render: context => <GitSideTab {...context} /> })
registerChatInfoSection('git.changes', 'File changes', context => <ChangedFilesSection {...context} />)
registerPanel('git.diff', DiffPanel, 'Diff')
