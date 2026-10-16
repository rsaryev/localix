import { Globe } from 'lucide-react'
import { defineUiLocation } from '@localixai/plugin-sdk/ui'

export default defineUiLocation({
  id: 'preview.open',
  uri: 'localix://ui/work-item/preview',
  title: 'Browser',
  description: 'Open the browser workspace',
  agent: { description: 'Open the browser workspace' },
  keywords: ['browser', 'website', 'app'],
  group: 'Application',
  Icon: Globe,
  effect: 'read',
  surface: 'work-item',
  exposure: { search: true, palette: true },
  resolve: () => ({
    kind: 'work-item',
    workKind: 'preview',
    id: 'preview',
    title: 'Browser',
  }),
})
