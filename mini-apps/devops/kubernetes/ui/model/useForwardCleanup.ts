import { useEffect } from 'react'
import { miniAppWorkspace } from '@localixai/mini-app-sdk/ui/runtime'
import { kubernetesApi } from '../api/kubernetesApi'

const POD_TAB_PREFIX = 'devops:kubernetes-pod:'

/** Collect the currently-open pod tab WorkItem ids from the grid item registry. */
function podTabIds(items: Record<string, unknown>): Set<string> {
  const ids = new Set<string>()
  for (const id of Object.keys(items)) if (id.startsWith(POD_TAB_PREFIX)) ids.add(id)
  return ids
}

/**
 * Tears down any managed API port-forward started FROM a pod's editor tab when that tab
 * closes. Forwards are tagged server-side with the pod tab's WorkItem id as their
 * `owner` — the id the host keyed it by, `<id>@<session>`, so the same pod open in two
 * chats owns two sets of forwards; this hook watches the grid item registry and, when a
 * `devops:kubernetes-pod:` tab disappears, asks the backend to stop every forward owned by
 * it. Forwards started from the always-present sidebar are unowned and therefore untouched.
 * Mounted once (in ChatPage), like the grid inspector bus. Reuses the grid store's item
 * registry as the close signal rather than component unmount — a pod tab body unmounts on
 * every tab switch (it is only mounted while active), so unmount is NOT a reliable close
 * signal; removal from the registry is.
 */
export function useKubernetesForwardCleanup(): void {
  useEffect(() => {
    let prev = podTabIds(miniAppWorkspace.getSnapshot().items)
    return miniAppWorkspace.subscribe(() => {
      const next = podTabIds(miniAppWorkspace.getSnapshot().items)
      if (next.size >= prev.size && [...prev].every((id) => next.has(id))) {
        prev = next
        return
      }
      const closed = [...prev].filter((id) => !next.has(id))
      prev = next
      for (const owner of closed) {
        // Best-effort: a forward may have already self-cleaned (pod deleted); the
        // backend simply stops 0 in that case. Never blocks the UI on this.
        void kubernetesApi.stopPortForwardsByOwner(owner).catch(() => {})
      }
    })
  }, [])
}
