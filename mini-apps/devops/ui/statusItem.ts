import { Gauge, Square } from 'lucide-react'
import type { MenuEntry, StatusItemState } from '@localixai/mini-app-sdk/ui'
import { miniAppWorkspace, runMiniAppAction, statusMenuList } from '@localixai/mini-app-sdk/ui'
import {
  createSharedResource,
  GLOBAL_RESOURCE_KEY,
} from '@localixai/mini-app-sdk/ui/shared-resource'

import type { PortForward } from '../kubernetes/backend/contract-forwards'
import { kubernetesApi } from '../kubernetes/ui/api/kubernetesApi'
import { DEVOPS_PORT_FORWARDS } from '../kubernetes/ui/model/topics'

const WORK_KIND = 'devops:workspace'

// Forwards move only when this app starts or stops one, and `kubernetesApi` invalidates the topic
// on every such call. So the list stays true with no subscription written here and zero polling.
const forwards = createSharedResource<PortForward[]>(() => kubernetesApi.listPortForwards(), {
  topic: DEVOPS_PORT_FORWARDS,
})

/**
 * Running port-forwards — the one DevOps fact that is invisible and outlives the surface that made it.
 *
 * NOT the container count, which is the obvious choice and the wrong one. Docker inventory lives
 * behind `useDocker`'s four-second poll; reading it here would either start that poll for every
 * session forever, or read its module cache and put a number in permanent chrome that stops being
 * true the moment the workspace closes. A count that is sometimes right is worse than no count.
 *
 * A forward is different in every way that matters. It binds a local port, it tunnels into a live
 * cluster, it survives the tab that started it when it was started from the sidebar, and nothing
 * on screen mentions it once the DevOps workspace is closed — which is exactly how a person ends
 * up wondering why 5432 is taken. It also changes only when this app changes it, so one
 * subscription keeps it honest with no polling at all.
 *
 * No tunnels, no control: the normal state of this mini app is silence.
 *
 * The tunnels are the machine's, so they show in every bar. Opening the workspace is not: it is a
 * session kind, so it opens in the chat this bar belongs to (`sessionId`), and a bar outside any
 * chat offers only the stops.
 */
export function useDevOpsForwardsStatusItem(sessionId: string | null): StatusItemState | null {
  const list = forwards.use(GLOBAL_RESOURCE_KEY)
  if (!list || list.length === 0) return null

  const openForwards = sessionId
    ? () =>
        miniAppWorkspace.openWorkItem({
          workKind: WORK_KIND,
          id: WORK_KIND,
          title: 'DevOps',
          scope: sessionId,
          payload: { area: 'kubernetes', kubernetesResource: 'portForwards' },
        })
    : undefined

  // A tunnel that refuses to close is the one failure this item exists to make visible: the port
  // stays bound, nothing on screen says why, and the next thing that wants 5432 fails instead.
  const stop = (forward: PortForward) =>
    runMiniAppAction(
      () => kubernetesApi.stopPortForward(forward.id),
      `Could not stop the port-forward on 127.0.0.1:${forward.localPort}`,
    )

  return {
    label:
      list.length === 1
        ? `DevOps — 1 port-forward running (127.0.0.1:${list[0]!.localPort})`
        : `DevOps — ${list.length} port-forwards running`,
    Icon: Gauge,
    badge: { count: list.length },
    tone: 'info',
    // Absent without a chat: the left click then opens the menu of stops.
    ...(openForwards ? { onClick: openForwards } : {}),
    menu: [
      ...(openForwards
        ? ([
            { id: 'open', label: 'Open port forwards', icon: Gauge, onSelect: openForwards },
            { separator: true },
          ] satisfies MenuEntry[])
        : []),
      ...statusMenuList({
        header: 'Stop a forward',
        items: list,
        row: (forward) => ({
          id: `forward:${forward.id}`,
          // The local end is the name: it is the half a person recognises, and the half they are
          // looking for when a port they wanted is already taken. The remote end is the hint,
          // where a long pod name truncates instead of pushing the panel wide.
          label: `127.0.0.1:${forward.localPort}`,
          hint: `${forward.pod}:${forward.podPort}`,
          icon: Square,
          danger: true,
          onSelect: () => stop(forward),
        }),
        ...(openForwards ? { onOverflow: openForwards } : {}),
        overflowLabel: (hidden) => `${hidden} more tunnels…`,
      }),
    ],
  }
}
