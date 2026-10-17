import { useEffect } from 'react'
import { forgetLastWorkspace } from '@/features/chat/model/persistence'
import { useChatStore } from '@/features/chat/model/store'
import { isDeadRoutedProject } from './urlSessionSelection'

/**
 * Leave a project route whose project the database no longer has — silently.
 *
 * The launch restore already drops a dead record on a cold `/`, but a restored workspace window
 * opens straight on its remembered project address, which outranks the restore. Nothing then
 * checked it: the window minted a New chat and published its UI catalog for the dead id, and
 * each refusal reached Event Center, repeatedly, per window. Drop this window's record of it and
 * land on the neutral home, which opens the default project. No notification: nothing the
 * person did is wrong, and there is nothing for them to fix.
 */
export function useDeadProjectRoute(
  routeProjectId: string | null | undefined,
  enabled: boolean,
  goReplace: (path: string) => void,
): void {
  const dead = useChatStore((state) => enabled && isDeadRoutedProject(state, routeProjectId))
  useEffect(() => {
    if (!dead) return
    forgetLastWorkspace()
    goReplace('/')
  }, [dead, goReplace])
}
