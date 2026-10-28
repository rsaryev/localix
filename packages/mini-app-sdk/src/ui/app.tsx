import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  type ComponentType,
  type ReactNode,
} from 'react'
import { z } from 'zod'
import type { MiniAppProblemLineProps } from './components'
import type { IconComponent, WorkItemAgentContext } from './contrib'
import type { MiniAppUiHost } from './host'
import { snippetMessageBindingDraft, type PublishMessageContext } from './message-bindings'
import type { ProblemReport } from './problems'
import { useStoreSnapshot } from './store-snapshot'
import { useProblemReport } from './use-problem-report'
import { useWorkItemSessionId } from './work-item-session'

/**
 * The app layer's screen side: a collection's items as live state, the agent told what the screen
 * shows, and one call that registers the screen. The counterpart of `createMiniApp` and
 * `defineCollection` in `@localixai/mini-app-sdk/backend`.
 */

/** The list a change answered with, or null when it failed. */
const itemsOf = <T,>(result: Promise<{ items: T[] } | null>) =>
  result.then((answer) => answer?.items ?? null)

/** A collection as a screen uses it. Every change answers with the new list, shown at once. */
export interface CollectionView<T, Input> {
  /** Oldest first. Empty until the first read. */
  items: T[]
  /** True until the first read settles. */
  loading: boolean
  /** The last read or change that failed, in words for the person; cleared by the next success. */
  error: string | null
  /** True while a change waits for its answer: disable what would send it again. */
  sending: boolean
  /** Resolve to the new list, or null when the change failed (`error` says why). */
  add: (input: Input) => Promise<T[] | null>
  update: (id: string, patch: Partial<Input>) => Promise<T[] | null>
  remove: (id: string) => Promise<T[] | null>
  refresh: () => void
}

/**
 * Read a collection of this mini app and change it. The agent's writes arrive the moment they land
 * (the store feed nudges the screen); the screen keeps no second copy of the list. A `chat`
 * collection is the one of the chat this screen belongs to.
 */
export function useCollection<T, Input = Omit<T, 'id'>>(options: {
  /** The mini app's name. */
  app: string
  /** The collection's name, as in its spec. */
  name: string
  item: z.ZodType<T>
  scope?: 'app' | 'chat'
  /** False while the screen is hidden: no reads. */
  active?: boolean
}): CollectionView<T, Input> {
  const { app, name, item, scope = 'app', active = true } = options
  const chat = useWorkItemSessionId()
  const sessionId = scope === 'chat' ? chat : null
  const query = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : ''
  const base = `/rpc/${app}/${name}`
  const schema = useMemo(() => z.object({ items: z.array(item) }), [item])
  const polled = useStoreSnapshot({
    miniApp: app,
    sessionId,
    path: `${base}${query}`,
    schema,
    intervalMs: 10_000,
    // A chat's collection outside a chat has nothing to read.
    active: active && (scope === 'app' || sessionId !== null),
    failureMessage: `Cannot read ${name} right now.`,
  })
  const { send } = polled
  const itemPath = useCallback(
    (id: string) => `${base}/${encodeURIComponent(id)}${query}`,
    [base, query],
  )
  return {
    items: polled.snapshot?.items ?? [],
    loading: polled.loading,
    error: polled.error,
    sending: polled.sending,
    refresh: polled.refresh,
    add: useCallback((input) => itemsOf(send(input)), [send]),
    update: useCallback(
      (id, patch) => itemsOf(send(patch, { path: itemPath(id), method: 'PATCH' })),
      [send, itemPath],
    ),
    remove: useCallback(
      (id) => itemsOf(send(undefined, { path: itemPath(id), method: 'DELETE' })),
      [send, itemPath],
    ),
  }
}

/**
 * Tell the agent what the screen shows while it is open: `context` (a label and the text the
 * agent reads) is attached to the person's next message. Cleared when the screen is hidden or
 * `context` is null, so the agent never describes numbers the person cannot see.
 */
export function useAgentContext(
  publish: PublishMessageContext | undefined,
  active: boolean,
  context: { label: string; content: string } | null,
): void {
  const label = context?.label
  const content = context?.content
  useEffect(() => {
    if (!publish) return
    if (!active || label === undefined || content === undefined) {
      publish(null)
      return
    }
    publish({ strategy: 'replace', bindings: [snippetMessageBindingDraft({ label, content })] })
  }, [publish, active, label, content])
  useEffect(() => () => publish?.(null), [publish])
}

/** What a screen receives from the host. */
export interface ScreenProps {
  /** False while the tab is hidden: pause reads and clear the agent's context. */
  active: boolean
  publishMessageContext: PublishMessageContext
}

/**
 * Register a mini app's screen: its tab, its launcher in the rail's overflow and what the agent is
 * told while it is open. `scope: 'chat'` gives every chat its own tab, for a screen whose data is
 * the chat's (`useCollection` with `scope: 'chat'`). Returns `registerUi`, which registers once per
 * host however often it is called.
 */
export function screenUi(screen: {
  app: string
  title: string
  /** The launcher's label: the title and what the app is for. */
  label: string
  keywords: string[]
  Icon: IconComponent
  /** Usually `lazy(() => import('./App'))`, so the screen's code loads when it first opens. */
  Screen: ComponentType<ScreenProps>
  /** Shown while the screen's code loads. */
  loading: ReactNode
  agentContext: WorkItemAgentContext
  scope?: 'app' | 'chat'
}): (host: MiniAppUiHost) => void {
  const { Screen } = screen
  const kind = `${screen.app}:screen`
  function Body({
    visible,
    publishMessageContext,
  }: {
    visible: boolean
    publishMessageContext: PublishMessageContext
  }) {
    return (
      <Suspense fallback={screen.loading}>
        <Screen active={visible} publishMessageContext={publishMessageContext} />
      </Suspense>
    )
  }
  const registered = new WeakSet<MiniAppUiHost>()
  return (host) => {
    if (registered.has(host)) return
    registered.add(host)
    host.workItems.register({
      kind,
      Component: Body,
      Icon: screen.Icon,
      restorable: true,
      scope: screen.scope === 'chat' ? 'session' : 'global',
      agentContext: screen.agentContext,
    })
    host.railViewlets.register({
      kind,
      title: screen.title,
      label: screen.label,
      defaultArea: 'overflow',
      keywords: screen.keywords,
      Icon: screen.Icon,
    })
  }
}

/**
 * A failed read or change, reported the way every Localix failure is: a `ProblemLine` on the
 * screen and a row in the Event Center. Call it above any early return and pass `failure: null`
 * while things work; spread the answer into `<ProblemLine {...problem} />`.
 */
export function useScreenProblem(options: {
  app: string
  /** What failed, named the way a person names it ("Entries"). */
  subject: string
  failure: string | null
  /** True while the last good data is still on screen: the problem is `stale`, not `blocked`. */
  showingData: boolean
}): MiniAppProblemLineProps | null {
  const { app, subject, failure, showingData } = options
  const report = useMemo<ProblemReport | null>(
    () =>
      failure
        ? {
            subject: { label: subject },
            problems: [{ message: failure }],
            consequence: showingData ? 'stale' : 'blocked',
          }
        : null,
    [subject, failure, showingData],
  )
  return useProblemReport(report, { scope: app, sourceVisible: true })
}
