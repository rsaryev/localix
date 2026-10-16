import { FolderTree } from 'lucide-react'
import { defineUiLocation } from '@localixai/plugin-sdk/ui'

export default defineUiLocation({
  id: 'files.open',
  uri: 'localix://ui/sidebar/files',
  title: 'Files',
  description: 'Open the workspace file explorer',
  agent: { description: 'Open the workspace file explorer' },
  keywords: ['explorer', 'tree', 'workspace'],
  group: 'Navigation',
  Icon: FolderTree,
  effect: 'read',
  surface: 'sidebar',
  exposure: { search: true, palette: true },
  resolve: () => ({ kind: 'rail-section', sectionId: 'files' }),
})
