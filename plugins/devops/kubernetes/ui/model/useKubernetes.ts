import { useRef, useState } from 'react'
import type { KubePod } from '../../backend/contracts'
import { initialKubernetesState, type KubernetesState } from './kubernetesState'
import type { KubernetesActiveScope } from './kubernetesScope'
import { useKubernetesInventory } from './useKubernetesInventory'
import { useKubernetesRecovery } from './useKubernetesRecovery'
import { useKubernetesScope } from './useKubernetesScope'
import { usePodPollLoop } from './usePodPollLoop'
import { usePodWatchLive } from './usePodWatchLive'

/**
 * Kubernetes workbench orchestration.
 *
 * Scope discovery, inventory refresh, recovery, poll fallback, and live watch each own a separate
 * hook. This facade keeps the public model stable for the sidebar and DevOps Workspace shell.
 */
export function useKubernetes(enabled = true) {
  const [state, setState] = useState<KubernetesState>(initialKubernetesState)
  const activeRef = useRef<KubernetesActiveScope>({ context: '', namespace: '' })
  const generationRef = useRef(0)
  const podsRef = useRef<KubePod[]>([])
  const watchLiveRef = useRef(false)
  const busyGenerationRef = useRef<number | null>(null)
  const lastSecondaryFetchAtRef = useRef(0)

  const refresh = useKubernetesInventory({
    setState,
    activeRef,
    generationRef,
    podsRef,
    busyGenerationRef,
    lastSecondaryFetchAtRef,
  })
  const scope = useKubernetesScope({
    setState,
    activeRef,
    generationRef,
    lastSecondaryFetchAtRef,
    refresh,
  })
  const recovery = useKubernetesRecovery({
    enabled,
    state,
    bootstrap: scope.bootstrap,
    refresh,
  })

  usePodPollLoop({
    enabled: recovery.liveReadsEnabled,
    namespace: state.activeNamespace,
    refresh,
    watchLiveRef,
    podsRef,
  })
  usePodWatchLive({
    enabled: recovery.liveReadsEnabled,
    context: state.activeContext,
    namespace: state.activeNamespace,
    activeRef,
    refresh,
    podsRef,
    watchLiveRef,
    setState,
  })

  return {
    ...state,
    autoRetrying: recovery.autoRetrying,
    recoveryPaused: recovery.recoveryPaused,
    refresh,
    retryBootstrap: scope.retryBootstrap,
    setActiveContext: scope.setActiveContext,
    setActiveNamespace: scope.setActiveNamespace,
  }
}

/** Shared model consumed by the standalone cluster view and the DevOps Workspace shell. */
export type KubernetesWorkbenchModel = ReturnType<typeof useKubernetes>
