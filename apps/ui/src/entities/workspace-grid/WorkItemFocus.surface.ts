import { PanelsTopLeft } from 'lucide-react'
import { defineUiLocation } from '@localixai/plugin-sdk/ui'
import { resolveExistingWorkItemFocus, useGridStore } from './model'

/**
 * Safe common denominator for a tab whose contents cannot be reconstructed from
 * a URI. The exact id must already exist and be visible in the current scope.
 * No payload crosses the navigation boundary and a missing tab fails closed.
 */
export default defineUiLocation({
  id: 'work-item.focus',
  uri: 'localix://ui/work-item/focus',
  title: 'Open tab',
  description: 'Focus an existing workspace tab',
  agent: {
    description: 'Focus an existing workspace tab when its live tab id is already known.',
    availability: 'runtime',
  },
  keywords: ['tab', 'editor', 'panel', 'focus'],
  group: 'Navigation',
  Icon: PanelsTopLeft,
  effect: 'read',
  surface: 'work-item',
  params: {
    id: {
      type: 'string',
      description: 'Live frontend tab id obtained from the current workspace state.',
      maxLength: 512,
    },
  },
  exposure: { search: false, palette: false },
  present: ({ id }) => {
    const item = useGridStore.getState().items[id]
    return {
      label: item ? `Open ${item.title}` : 'Open tab',
      ...(item ? { description: `Focus the existing ${item.kind} tab` } : {}),
    }
  },
  resolve: ({ id }) => {
    const state = useGridStore.getState()
    return resolveExistingWorkItemFocus(state, id)
  },
})
