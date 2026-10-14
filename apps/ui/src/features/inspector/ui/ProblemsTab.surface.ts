import { CircleAlert } from 'lucide-react'
import { defineUiLocation } from '@localixai/plugin-sdk/ui'

export default defineUiLocation({
  id: 'problems.open',
  uri: 'localix://ui/work-item/problems',
  title: 'Problems',
  description: 'Open workspace diagnostics',
  agent: { description: 'Open workspace diagnostics' },
  keywords: ['errors', 'warnings', 'lsp', 'diagnostics'],
  group: 'Application',
  Icon: CircleAlert,
  effect: 'read',
  surface: 'work-item',
  exposure: { search: true, palette: true },
  resolve: () => ({
    kind: 'work-item',
    workKind: 'problems',
    id: 'problems',
    title: 'Problems',
  }),
})
