import { FolderSync } from 'lucide-react'
import { defineUiLocation } from '@localixai/plugin-sdk/ui'

export const PROJECT_SWITCHER_OVERLAY_ID = 'project-switcher'

export default defineUiLocation({
  id: 'projects.switcher.open',
  uri: 'localix://ui/picker/project-switcher',
  title: 'Switch workspace',
  description: 'Open the project picker',
  agent: { description: 'Open the project picker' },
  keywords: ['folder', 'project', 'recent'],
  group: 'Navigation',
  Icon: FolderSync,
  effect: 'read',
  surface: 'picker',
  exposure: { search: true, palette: true },
  resolve: () => ({ kind: 'overlay', overlayId: PROJECT_SWITCHER_OVERLAY_ID }),
})
