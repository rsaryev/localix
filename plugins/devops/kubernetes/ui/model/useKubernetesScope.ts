import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react'
import { kubernetesApi } from '../api/kubernetesApi'
import {
  loadK8sSelection,
  resolveActiveNamespace,
  resolveInitialContext,
  saveK8sSelection,
  type K8sSelection,
} from './selection'
import { degrade, type KubernetesState } from './kubernetesState'
import { kubernetesScopeIsCurrent, type KubernetesActiveScope } from './kubernetesScope'
import type { KubernetesRefreshOptions } from './useKubernetesInventory'

interface KubernetesScopeOptions {
  setState: Dispatch<SetStateAction<KubernetesState>>
  activeRef: MutableRefObject<KubernetesActiveScope>
  generationRef: MutableRefObject<number>
  lastSecondaryFetchAtRef: MutableRefObject<number>
  refresh: (options?: KubernetesRefreshOptions) => Promise<void>
}

/** Context discovery, namespace selection, persistence, and scope-generation invalidation. */
export function useKubernetesScope(options: KubernetesScopeOptions) {
  const { setState, activeRef, generationRef, lastSecondaryFetchAtRef, refresh } = options
  const bootstrapBusy = useRef(false)
  const selectionRef = useRef<K8sSelection | null>(null)
  if (selectionRef.current === null) selectionRef.current = loadK8sSelection()

  const persistSelection = useCallback(() => {
    if (selectionRef.current) saveK8sSelection(selectionRef.current)
  }, [])

  const loadNamespaces = useCallback(
    async (context: string, generation: number): Promise<string | null> => {
      const stamp = { context, generation }
      try {
        const namespaces = await kubernetesApi.listNamespaces(context || undefined)
        if (!kubernetesScopeIsCurrent(activeRef.current, generationRef.current, stamp)) return null
        const stored = selectionRef.current?.namespaceByContext[context]
        const next = resolveActiveNamespace(stored, activeRef.current.namespace, namespaces)
        activeRef.current.namespace = next
        setState((state) => ({
          ...state,
          namespaces,
          activeNamespace: next,
          unavailable: false,
          unreachable: false,
          error: null,
        }))
        return next
      } catch (cause) {
        if (!kubernetesScopeIsCurrent(activeRef.current, generationRef.current, stamp)) return null
        setState((state) => ({ ...state, namespaces: [], loading: false, ...degrade(cause) }))
        return null
      }
    },
    [activeRef, generationRef, setState],
  )

  const loadContextScope = useCallback(
    async (context: string, generation: number): Promise<boolean> => {
      const namespace = await loadNamespaces(context, generation)
      if (
        !kubernetesScopeIsCurrent(activeRef.current, generationRef.current, {
          context,
          generation,
        })
      ) {
        return false
      }
      if (!namespace) {
        setState((state) => ({ ...state, loading: false, refreshing: false }))
      }
      return namespace !== null
    },
    [activeRef, generationRef, loadNamespaces, setState],
  )

  const bootstrap = useCallback(
    async ({ visible = false }: { visible?: boolean } = {}): Promise<boolean> => {
      if (bootstrapBusy.current) return false
      bootstrapBusy.current = true
      const discoveryGeneration = generationRef.current
      if (visible) setState((state) => ({ ...state, refreshing: true }))
      try {
        const { contexts, current } = await kubernetesApi.listContexts()
        if (discoveryGeneration !== generationRef.current) return false
        const activeContext = resolveInitialContext(
          selectionRef.current?.context,
          contexts,
          current,
        )
        if (activeRef.current.context !== activeContext) activeRef.current.namespace = ''
        activeRef.current.context = activeContext
        const generation = ++generationRef.current
        lastSecondaryFetchAtRef.current = 0
        setState((state) => ({
          ...state,
          contexts,
          currentContext: current,
          activeContext,
          ...(activeContext
            ? {}
            : {
                loading: false,
                unavailable: false,
                unreachable: false,
                error: null,
              }),
        }))
        return activeContext ? loadContextScope(activeContext, generation) : true
      } catch (cause) {
        if (discoveryGeneration !== generationRef.current) return false
        setState((state) => ({ ...state, loading: false, refreshing: false, ...degrade(cause) }))
        return false
      } finally {
        bootstrapBusy.current = false
        if (visible) {
          setState((state) => (state.refreshing ? { ...state, refreshing: false } : state))
        }
      }
    },
    [activeRef, generationRef, lastSecondaryFetchAtRef, loadContextScope, setState],
  )

  useEffect(() => {
    void bootstrap()
  }, [bootstrap])

  const setActiveContext = useCallback(
    (context: string) => {
      if (context === activeRef.current.context) return
      const generation = ++generationRef.current
      activeRef.current = { context, namespace: '' }
      lastSecondaryFetchAtRef.current = 0
      if (selectionRef.current) selectionRef.current.context = context
      persistSelection()
      setState((state) => ({
        ...state,
        activeContext: context,
        activeNamespace: '',
        pods: [],
        deployments: [],
        services: [],
        resourceErrors: {},
        namespaces: [],
        loading: true,
      }))
      void loadContextScope(context, generation)
    },
    [
      activeRef,
      generationRef,
      lastSecondaryFetchAtRef,
      loadContextScope,
      persistSelection,
      setState,
    ],
  )

  const setActiveNamespace = useCallback(
    (namespace: string) => {
      generationRef.current += 1
      activeRef.current.namespace = namespace
      lastSecondaryFetchAtRef.current = 0
      if (selectionRef.current) {
        selectionRef.current.namespaceByContext[activeRef.current.context] = namespace
      }
      persistSelection()
      setState((state) => ({
        ...state,
        activeNamespace: namespace,
        pods: [],
        deployments: [],
        services: [],
        resourceErrors: {},
        loading: true,
      }))
      void refresh({ forceSecondary: true })
    },
    [activeRef, generationRef, lastSecondaryFetchAtRef, persistSelection, refresh, setState],
  )

  const retryBootstrap = useCallback(() => {
    void bootstrap({ visible: true })
  }, [bootstrap])

  return { bootstrap, retryBootstrap, setActiveContext, setActiveNamespace }
}
