import { Puzzle } from 'lucide-react'
import { defineUiLocation } from '@localixai/plugin-sdk/ui'

/** The workspace plugin launcher: one row per plugin view, click to open it. */
export default defineUiLocation({
  id: 'plugins.open',
  uri: 'localix://ui/sidebar/plugins',
  title: 'Plugins',
  description: 'Open the plugin launcher',
  agent: { description: 'Open the plugin launcher' },
  keywords: ['plugins', 'views', 'extensions'],
  group: 'Application',
  Icon: Puzzle,
  effect: 'read',
  surface: 'sidebar',
  exposure: { search: true, palette: true },
  resolve: () => ({
    kind: 'rail-section',
    sectionId: 'plugins',
  }),
})
