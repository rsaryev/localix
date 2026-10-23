import { SquareStack } from 'lucide-react'
import type { PluginUiHost, UiAnchorNode } from '@localixai/mini-app-sdk/ui'
import { listUiLocations } from '@/shared/contrib/uiLocations'

const ROOT = 'localix://ui/page/catalog'

function listChildren(parent: string | null): UiAnchorNode[] {
  if (parent === null) {
    return [
      {
        uri: ROOT,
        label: 'Workspace views',
        detail: 'Search, files, and plugin workbenches',
        hasChildren: true,
        icon: 'ui-views',
        group: 'Application',
      },
    ]
  }
  if (parent !== ROOT) return []
  const locations: UiAnchorNode[] = []
  for (const location of listUiLocations({ exposure: 'search' })) {
    if (
      !location.uri.startsWith('localix://ui/') ||
      location.surface === 'settings' ||
      location.surface === 'action'
    ) {
      continue
    }
    locations.push({
      uri: location.uri,
      label: location.title,
      detail: location.description,
      hasChildren: false,
      icon: location.icon ?? 'ui-views',
    })
  }
  return locations
}

export function registerUi(host: PluginUiHost): void {
  host.anchors.register({
    id: 'workspace-views',
    namespaces: ['page'],
    icons: {
      'ui-views': SquareStack,
    },
    listChildren,
    resolve: () => null,
  })
}
