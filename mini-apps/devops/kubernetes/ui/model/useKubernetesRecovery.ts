import { useEffect, useState } from 'react'
import { runAsBackgroundWork } from '@localixai/mini-app-sdk/ui/visibility'
import type { KubernetesState } from './kubernetesState'
import {
  canAutoRetryKubernetes,
  kubernetesRecoveryDelay,
  kubernetesRecoveryKey,
  kubernetesRecoveryTarget,
} from './kubernetesRecovery'
import type { KubernetesRefreshOptions } from './useKubernetesInventory'

interface KubernetesRecoveryOptions {
  enabled: boolean
  state: KubernetesState
  bootstrap: (options?: { visible?: boolean }) => Promise<boolean>
  refresh: (options?: KubernetesRefreshOptions) => Promise<void>
}

/** One bounded retry owner for bootstrap and collection failures. */
export function useKubernetesRecovery(options: KubernetesRecoveryOptions) {
  const { enabled, state, bootstrap, refresh } = options
  const [recovery, setRecovery] = useState({ key: '', attempts: 0, running: false })
  const target = kubernetesRecoveryTarget(state)
  const key = kubernetesRecoveryKey(state)
  const recoveryPaused =
    target !== null &&
    recovery.key === key &&
    !recovery.running &&
    !canAutoRetryKubernetes(recovery.attempts)
  const hasReadFailure =
    state.unavailable ||
    state.unreachable ||
    state.error !== null ||
    Object.values(state.resourceErrors).some(Boolean)
  const liveReadsEnabled = enabled && target === null && !hasReadFailure

  useEffect(() => {
    if (!enabled) return
    if (!target) {
      if (
        !state.loading &&
        !state.refreshing &&
        (recovery.key || recovery.attempts || recovery.running)
      ) {
        setRecovery({ key: '', attempts: 0, running: false })
      }
      return
    }
    if (recovery.key !== key) {
      setRecovery({ key, attempts: 0, running: false })
      return
    }
    if (
      state.loading ||
      state.refreshing ||
      recovery.running ||
      !canAutoRetryKubernetes(recovery.attempts)
    ) {
      return
    }

    const timer = setTimeout(() => {
      setRecovery((current) =>
        current.key === key
          ? { ...current, attempts: current.attempts + 1, running: true }
          : current,
      )
      // An automatic retry is the timer's work, not the person's (see `runAsBackgroundWork`).
      void runAsBackgroundWork(async () => {
        if (target === 'bootstrap') await bootstrap()
        else await refresh({ forceSecondary: true, silent: true })
        setRecovery((current) => (current.key === key ? { ...current, running: false } : current))
      })
    }, kubernetesRecoveryDelay(recovery.attempts))
    return () => clearTimeout(timer)
  }, [bootstrap, enabled, key, recovery, refresh, state.loading, state.refreshing, target])

  return {
    liveReadsEnabled,
    recoveryPaused,
    autoRetrying:
      enabled &&
      target !== null &&
      recovery.key === key &&
      canAutoRetryKubernetes(recovery.attempts),
  }
}
