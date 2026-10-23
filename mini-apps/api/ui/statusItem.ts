import { Globe } from 'lucide-react'
import type { StatusItemState, MenuEntry } from '@localixai/mini-app-sdk/ui'
import { miniAppWorkspace, runMiniAppAction } from '@localixai/mini-app-sdk/ui'
import { createSharedResource } from '@localixai/mini-app-sdk/ui/shared-resource'
import { useMiniAppWorkspace } from '@localixai/mini-app-sdk/ui/runtime-hooks'

import type { EnvironmentInfo } from '../backend/contracts'
import { restApi } from './restApi'
import { subscribeApiWorkspaceCommands } from './model/collectionEvents'
import { environmentEntries } from './model/environmentEntries'
import { API_ENVIRONMENTS } from './model/topics'

const WORKSPACE_KIND = 'api:workspace'

/**
 * The saved environments, keyed by the chat they are read for. They live beside the collection in
 * that chat's project, so one shared answer would show the titlebar of chat B the environment
 * chosen in chat A's project.
 */
const environments = createSharedResource<EnvironmentInfo[]>(
  (sessionId) => restApi.environments(sessionId),
  { topic: API_ENVIRONMENTS },
)

/**
 * Re-read when the set actually moves — from EITHER of the two places it can.
 *
 * The agent switching an environment mid-turn arrives on the command bus. A person switching it in
 * the sidebar does not: that is a local call, and it used to update the picker's own state and
 * nothing else, so the titlebar went on naming the environment you had just left. The two paths
 * are folded into one signal here — the command bus feeds the local announcement, and `restApi`
 * raises the same one after every write — so the titlebar cannot disagree with the panel whichever
 * of them caused the change. One subscription for the life of the app, and still no poll.
 */
subscribeApiWorkspaceCommands((command) => {
  if (command.type === 'collection_changed' && command.target === 'environment') {
    API_ENVIRONMENTS.invalidate()
  }
})

/**
 * Which deployment the next request will hit — the one API-client fact worth permanent chrome.
 *
 * An environment is a set of variables a saved request interpolates, so the active one decides
 * whether `{{host}}` means localhost or production. That is knowable only by opening the panel
 * today, which is the wrong place for it: the moment it matters is the moment you are about to
 * send, and by then the panel has usually told you what you already assumed.
 *
 * No environments means no answer to give, so no control at all — the same rule that keeps the git
 * item out of the chrome outside a repository. No chat (`sessionId` null) means no project to read
 * them from, so no item either.
 */
export function useApiEnvironmentStatusItem(sessionId: string | null): StatusItemState | null {
  const workspace = useMiniAppWorkspace()
  const list = environments.use(sessionId)

  const focusedId = workspace.focusedId
  const active = focusedId ? workspace.items[focusedId]?.kind === WORKSPACE_KIND : false

  if (!sessionId || !list || list.length === 0) return null

  const current = list.find((environment) => environment.active)

  const open = () =>
    miniAppWorkspace.openWorkItem({
      workKind: WORKSPACE_KIND,
      id: WORKSPACE_KIND,
      title: 'API Client',
      scope: sessionId,
    })

  // No refresh of its own: `restApi.useEnvironment` invalidates the topic and this item is a
  // subscriber like any other. A call site that refreshed by hand would be the second rule, and
  // the second rule is the one that gets forgotten.
  //
  // A failure has to be SAID, though. `void promise` left an unhandled rejection and a menu that
  // closed with the old environment still selected — indistinguishable from a row that does
  // nothing, which is the least explicable thing a UI can do.
  const activate = (name: string) =>
    runMiniAppAction(
      () => restApi.useEnvironment(sessionId, name),
      name === '' ? 'Could not clear the environment' : `Could not switch to “${name}”`,
    )

  const menu: MenuEntry[] = [
    { id: 'open', label: 'Open API Client', icon: Globe, onSelect: open },
    { separator: true },
    // Inline rather than behind an `Environment ▸` trigger: which deployment the next send hits is
    // the whole subject of this item, so it is the one thing that must not need a hover. The rows
    // are the sidebar picker's own list — "No environment" included — so the two cannot drift.
    ...environmentEntries({
      environments: list,
      onUse: activate,
      header: 'Send against',
      onOverflow: open,
    }),
  ]

  return {
    label: current
      ? `API Client — sending against “${current.name}”`
      : 'API Client — no environment selected',
    Icon: Globe,
    ...(current ? { text: current.name } : {}),
    // An unselected environment is not an error, but it IS the state where `{{host}}` resolves to
    // nothing and a send fails in a way the response body explains badly.
    ...(current ? {} : { tone: 'warning' as const }),
    active,
    onClick: () => (active && focusedId ? miniAppWorkspace.closeWorkItems(focusedId) : open()),
    menu,
  }
}
