import { BarChart3 } from 'lucide-react'
import { defineUiLocation } from '@localixai/mini-app-sdk/ui'

export default defineUiLocation({
  id: 'usage.open',
  uri: 'localix://ui/work-item/stats',
  title: 'Usage statistics',
  description: 'Open token usage and spend',
  agent: { description: 'Open token usage and spend' },
  keywords: ['usage', 'spend', 'cost', 'tokens'],
  group: 'Application',
  Icon: BarChart3,
  effect: 'read',
  surface: 'work-item',
  exposure: { search: true },
  resolve: () => ({ kind: 'inspector', target: 'stats' }),
})
