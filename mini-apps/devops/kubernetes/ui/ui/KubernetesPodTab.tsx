import { useEffect, useState } from 'react'
import type { KubePod } from '../../backend/contracts'
import { containerLabel, reconcileContainerSelection } from '../model/podContainers'
import { useUsageMetrics } from '../model/useUsageMetrics'
import { podUsageKey } from '../model/usage'
import { usePodTabContent } from '../model/usePodTabContent'
import { podSnapshotMatches, usePodTabSeed } from '../model/usePodTabSeed'
import { usePodPortForwards } from '../model/usePodPortForwards'
import { usePodTabActions } from '../model/usePodTabActions'
import type { PodTabView } from '../model/podTabView'
import { DevOpsProblem } from '../../../ui/DevOpsProblem'
import { PortForwardDialog } from './PortForwardDialog'
import { PodTabHeader } from './PodTabHeader'
import { PodPortForwards } from './PodPortForwards'
import { PodSummary } from './PodSummary'
import { PodTabContent } from './PodTabContent'
import { resourceMessageBindingDraft, type PublishMessageContext } from '@localixai/mini-app-sdk/ui'
import { buildK8sPodViewUri } from '../model/resourceLink'
import { ConfirmDialog } from '@localixai/kit/confirm-dialog'

/**
 * A pod editor tab composed from four independent lifecycles: watch-backed identity,
 * selected-view content, owner-scoped port forwards, and user actions.
 */
export function KubernetesPodTab({
  sessionId,
  tabId,
  active = true,
  podName,
  namespace,
  context,
  initialPod,
  publishMessageContext,
}: {
  /** The chat this tab belongs to (its work item's session) — where Exec opens its shell. */
  sessionId: string
  /** The tab's own work-item id as the host keyed it (`<id>@<session>`) — the forward owner. */
  tabId: string
  active?: boolean
  podName: string
  namespace: string
  context?: string
  initialPod?: KubePod
  publishMessageContext?: PublishMessageContext
}) {
  const seededPod = podSnapshotMatches(initialPod, podName, namespace) ? initialPod : null
  const [view, setView] = useState<PodTabView>('logs')
  const [container, setContainer] = useState(seededPod?.containers[0] ?? '')
  const [reconciledPod, setReconciledPod] = useState<KubePod | null | undefined>(undefined)
  const [forwarding, setForwarding] = useState(false)

  const seed = usePodTabSeed({ active, podName, namespace, context, initialPod })
  const { pod } = seed
  // The selection follows the pod's containers: kept while it still exists, otherwise the first
  // app container. Decided while rendering, when the pod changes, so no frame shows a gone one.
  if (pod !== reconciledPod) {
    setReconciledPod(pod)
    setContainer((current) => reconcileContainerSelection(current, pod))
  }

  const content = usePodTabContent({
    active,
    podName,
    namespace,
    context,
    pod,
    view,
    container,
  })
  // The tab's REAL id, not the bare `podTabWorkItemId`: a session tab is keyed `<id>@<session>`,
  // so the bare id never matched the closed tab the cleanup sees (its forwards outlived it), and
  // the same pod open in two chats shared one owner — closing either stopped both chats' tunnels.
  const forwardOwner = tabId
  const portForwards = usePodPortForwards(active, forwardOwner)
  const actions = usePodTabActions({
    sessionId,
    podName,
    namespace,
    context,
    container,
    markAbsent: seed.markAbsent,
    stopForward: portForwards.stop,
  })
  const running = pod?.phase === 'Running'
  const { podUsage } = useUsageMetrics({
    enabled: active && running,
    context: context ?? '',
    namespace,
    wantPods: true,
    wantNodes: false,
  })
  const usage = podUsage.get(podUsageKey(namespace, podName))

  useEffect(() => {
    if (!publishMessageContext || !podName || !namespace) return
    publishMessageContext({
      strategy: 'replace',
      bindings: [
        resourceMessageBindingDraft({
          uri: buildK8sPodViewUri({
            context,
            namespace,
            name: podName,
            view,
            ...(view === 'logs' && container ? { container } : {}),
            ...(view === 'logs' && content.previousLogs ? { previous: true } : {}),
          }),
          label: `${podName} ${view}${
            view === 'logs' && container
              ? ` · ${containerLabel(container)}${content.previousLogs ? ' · previous' : ''}`
              : ''
          }`,
        }),
      ],
    })
  }, [container, content.previousLogs, context, namespace, podName, publishMessageContext, view])

  const manualRefresh = () => {
    void seed.seedPod()
    void content.refreshView()
  }

  // No ground coat: the hosting pane already paints one, and under the host's macOS glass theme
  // the ground tokens carry alpha — a second pane-sized coat compounds into an opaque slab.
  return (
    <div className="@container flex h-full flex-col">
      <PodTabHeader
        pod={pod}
        podName={podName}
        usage={usage}
        namespace={namespace}
        context={context}
        view={view}
        setView={setView}
        container={container}
        setContainer={setContainer}
        running={!!running}
        busy={actions.busy}
        onDeleteRequest={() => actions.setConfirmDelete(true)}
        onExec={() => void actions.exec()}
        onForward={() => setForwarding(true)}
        onRefresh={manualRefresh}
      />

      {/* Deleting a pod is the heaviest thing this tab can do and it used to be guarded by two
          small buttons that swapped into the header row. Same question, same surface as the
          sidebar's pod delete and the deployment restart beside it. */}
      <ConfirmDialog
        open={actions.confirmDelete}
        title={`Delete pod ${podName}?`}
        description={`The pod is deleted from ${namespace}. A controller-managed pod is recreated; a bare one is gone for good.`}
        confirmLabel="Delete pod"
        onConfirm={() => void actions.deletePod()}
        onClose={() => actions.setConfirmDelete(false)}
      />

      <DevOpsProblem
        // The subject is the pod, NOT the sentence: a subject that changes with the error settles
        // nothing, so the row for the delete that failed stood next to the exec that failed after it.
        subject={`${podName} actions`}
        title={actions.error?.title}
        issue={actions.error?.issue}
        onDismiss={actions.dismissError}
      />
      <PodPortForwards
        forwards={portForwards.forwards}
        stopping={portForwards.stopping}
        onStop={(id) => void actions.stopForward(id)}
      />
      {pod && <PodSummary sessionId={sessionId} pod={pod} context={context} />}

      <div className="min-h-0 flex-1">
        <PodTabContent
          loading={seed.loading}
          error={seed.error}
          pod={pod}
          view={view}
          podName={podName}
          namespace={namespace}
          context={context}
          container={container}
          logs={content.logs}
          describe={content.describe}
          events={content.events}
          viewError={content.viewError}
          logsLive={content.logsLive}
          previousLogs={content.previousLogs}
          onLogPlaybackChange={content.setLogPlayback}
          onTogglePreviousLogs={content.togglePreviousLogs}
        />
      </div>

      <PortForwardDialog
        pod={forwarding ? (pod ?? { name: podName }) : null}
        namespace={namespace}
        context={context || undefined}
        owner={forwardOwner}
        onClose={() => setForwarding(false)}
        onStarted={portForwards.add}
      />
    </div>
  )
}
