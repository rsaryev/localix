import { useMemo } from 'react'
import { useChatStore } from '@/entities/chat/model/store'
import { storeApi } from '@/shared/api/store-client'
import { useUiNavigation } from '@/shared/hooks/useUiNavigation'
import type { StoreTarget } from '@/shared/lib/openStore'
import { useStoreInstallExtras } from '@/shared/lib/storeInstallExtra'
import { navigateUi } from '@/shared/lib/uiNavigation'
import { StoreView } from './StoreView'

/**
 * The Store's tab: the Store over `/rpc/store`, for the project open beside it, with the install
 * extras other features provide, and addresses — an installed package, a provider's settings —
 * opened through the app's navigation.
 */
export function StorePage({ target }: { target?: StoreTarget }) {
  const extras = useStoreInstallExtras()
  // A screen a mini app puts in the rail is usually one per chat: Open names the chat that is
  // open, as a rail button does, or the grid has no chat to put its tab in and refuses it.
  const navigation = useUiNavigation({ sessionId: useChatStore((s) => s.activeSessionId) })
  const projectId = useChatStore((s) => s.activeProjectId ?? null)
  const projects = useChatStore((s) => s.projects)
  const project = useMemo(() => {
    const found = projects.find((candidate) => candidate.id === projectId)
    return found ? { id: found.id, name: found.name } : null
  }, [projects, projectId])
  return (
    <div className="@container h-full min-h-0">
      <StoreView
        client={storeApi}
        target={target}
        extras={extras}
        project={project}
        onNavigate={(uri) => void navigateUi(uri, navigation)}
      />
    </div>
  )
}
