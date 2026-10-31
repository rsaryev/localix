import { Suspense } from 'react'
import { KeyRound } from 'lucide-react'

import type { MiniAppUiHost, UiAnchorNode } from '@localixai/mini-app-sdk/ui'
import { localixResourceUri } from '@localixai/mini-app-sdk/navigation'
import type { WorkItem } from '@/shared/lib/workItem'
import { LoadingHint } from '@localixai/kit/empty-hint'
import { vaultKeyFromResourceUri } from './model/vaultResource'
import { lazyNamed } from '@/shared/lib/lazyNamed'

const VaultWorkspaceLazy = lazyNamed(() => import('./ui/VaultWorkspace'), 'VaultWorkspace')

function VaultWorkspaceBody({ item }: { item: WorkItem }) {
  const selectedKey =
    typeof item.payload?.selectedKey === 'string' ? item.payload.selectedKey : undefined
  return (
    <Suspense fallback={<LoadingHint>Opening Vault…</LoadingHint>}>
      <VaultWorkspaceLazy requestedKey={selectedKey} />
    </Suspense>
  )
}

const vaultChildren = (parentUri: string | null): UiAnchorNode[] => {
  if (parentUri !== null) return []
  return [
    {
      uri: localixResourceUri('vault', ['items']),
      label: 'Vault',
      detail: 'Secrets, provider credentials, and secure items',
      hasChildren: false,
      icon: 'vault',
      group: 'Application',
    },
  ]
}

let registered = false

export function registerUi(host: MiniAppUiHost): void {
  if (registered) return
  registered = true

  host.workItems.register({
    kind: 'secrets-manager',
    Component: VaultWorkspaceBody,
    Icon: KeyRound,
    restorable: true,
    scope: 'global',
  })

  host.railViewlets.register({
    kind: 'secrets-manager',
    title: 'Vault',
    label: 'Vault — secrets & credentials',
    toolCategory: 'utilities',
    defaultArea: 'bar',
    keywords: ['vault', 'secrets', 'credentials', 'passwords', 'api keys', 'oauth'],
    Icon: KeyRound,
  })

  host.anchors.register({
    id: 'vault',
    namespaces: ['vault'],
    icons: { vault: KeyRound },
    listChildren: vaultChildren,
    resolve: (uri) => {
      if (uri === localixResourceUri('vault', ['items'])) {
        return {
          kind: 'work-item',
          workKind: 'secrets-manager',
          id: 'secrets-manager',
          title: 'Vault',
        }
      }
      const selectedKey = vaultKeyFromResourceUri(uri)
      return selectedKey
        ? {
            kind: 'work-item',
            workKind: 'secrets-manager',
            id: 'secrets-manager',
            title: 'Vault',
            payload: { selectedKey },
          }
        : null
    },
  })
}
