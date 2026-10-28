import {
  plainDataProblem,
  type ElementHandlers,
  type HookOrigin,
  type JsonElement,
} from '@localixai/claude-plugin/mods'
import { UnprocessableError } from '../../lib/domain-errors'
import { whileDrawing } from './api/state-api'
import type { ClientBundle } from './client-modules'
import type { ModScene } from './contracts'
import type { ModRegistry } from './registry'
import { drawingOf, runControl, type ControlAction } from './site-controls'

/**
 * A mod's panes on a Localix screen. A pane is drawn through `ui.render` with the `Pane` site (on
 * the `desktop` surface: Localix is a desktop app), every mod's hooks able to restyle it; the
 * drawing goes to the screen as JSON, and its controls' closures stay here, by pane and key. A
 * press, a typed value or a pick comes back through `ui.press`, `ui.input` or `ui.select`, whose
 * core runs that closure, as Claude Code's does. A `Client` in a pane runs its surface module on
 * the screen; what it posts comes back as `ui.message`, which only its own plugin's hooks hear.
 */

export interface PaneDrawing {
  /** The mod instance whose pane it is (`instance-id.ts`). */
  instance: string
  plugin: string
  id: string
  title?: string
  /** Null when no hook drew the pane, or its drawing did not validate. */
  tree: Array<JsonElement | string> | null
  problem?: string
}

type Dispatch = (
  event: string,
  input: unknown,
  core: (event: unknown) => unknown,
  scene: ModScene,
  instances?: ReadonlySet<string>,
  origin?: HookOrigin,
) => Promise<unknown>

export interface PaneViewport {
  columns: number
  rows: number
}

export function createModPanes(deps: {
  dispatch: Dispatch
  registry: ModRegistry
  changed: () => void
  /** Where an instance's pane events run: its project, and the mods loaded there. */
  sceneOf: (instance: string) => { scene: ModScene; instances: ReadonlySet<string> }
  /** The surface module an instance's `Client` names, as its host built it. */
  clientOf?: (instance: string, module: string) => ClientBundle | undefined
}) {
  const handlers = new Map<string, Map<string, ElementHandlers>>()
  /** Each drawn pane's `Client`s: their module, by key. */
  const clients = new Map<string, Map<string, string>>()
  const paneKey = (instance: string, id: string) => `${instance}\u0000${id}`
  /** A pane's events run in the conversation that opened it, so its `$` acts there. */
  const send = (
    instance: string,
    event: string,
    input: unknown,
    core: (e: unknown) => unknown,
    id?: string,
  ) => {
    const { scene, instances } = deps.sceneOf(instance)
    const sessionId = id === undefined ? undefined : deps.registry.pane(instance, id)?.sessionId
    return deps.dispatch(event, input, core, sessionId ? { ...scene, sessionId } : scene, instances)
  }

  async function render(
    instance: string,
    id: string,
    viewport: PaneViewport = { columns: 100, rows: 40 },
  ): Promise<PaneDrawing | null> {
    const pane = deps.registry.pane(instance, id)
    if (!pane) return null
    const { plugin } = pane
    const event = {
      component: 'Pane',
      surface: 'desktop',
      requestId: id,
      props: {
        title: pane.title ?? id,
        isFocused: true,
        bodyColumns: viewport.columns,
        placement: 'dock',
        scroll: { bodyRows: viewport.rows, offset: 0 },
        // The main conversation's transcript is in view: Localix opens no agent's in its place.
        view: {},
      },
      viewport: { ...viewport, isFullscreen: false },
    }
    // The state its hooks read subscribes the pane: a write to it draws the pane again.
    const drawn = await whileDrawing(paneKey(instance, id), () =>
      send(instance, 'ui.render', event, () => ({ type: 'engine' }), id),
    )
    const drawing = { instance, plugin, id, title: pane.title }
    const own = drawingOf(drawn, {
      client: (module) => deps.clientOf?.(instance, module)?.revision,
    })
    if (own.tree === null) return { ...drawing, ...own }
    const { handlers: controls, clients: drawnClients } = own as {
      handlers: Map<string, ElementHandlers>
      clients: Map<string, string>
    }
    handlers.set(paneKey(instance, id), controls)
    clients.set(paneKey(instance, id), drawnClients)
    return { ...drawing, tree: own.tree }
  }

  /** Where a drawn `Client` sits, as `ui.message` and `ui.fault` name it; null when not drawn. */
  function clientIn(instance: string, id: string, key: string) {
    const module = clients.get(paneKey(instance, id))?.get(key)
    if (module === undefined) return null
    const { scene } = deps.sceneOf(instance)
    const at = { surface: 'desktop', component: 'Pane', requestId: id, element: key, module }
    return { at, scene, own: new Set([instance]) }
  }

  /**
   * What a `Client` posted (`surface.post`): `ui.message` to its own plugin's hooks, `next.origin`
   * naming `client`. Core answers `{}`; a hook's `{ props }` goes back to the posting instance.
   */
  async function message(
    instance: string,
    id: string,
    key: string,
    data: unknown,
  ): Promise<{ props?: unknown } | null> {
    const client = clientIn(instance, id, key)
    if (!client) return null
    const problem = plainDataProblem(data)
    if (problem)
      throw new UnprocessableError(
        'mod_client_post_invalid',
        `The post is not plain data: ${problem}`,
      )
    const answer = await deps.dispatch(
      'ui.message',
      { ...client.at, data },
      () => ({}),
      client.scene,
      client.own,
      CLIENT_ORIGIN,
    )
    const props = (answer as { props?: unknown } | null)?.props
    return props !== undefined && plainDataProblem(props) === null ? { props } : {}
  }

  /** A `Client` that failed to load, draw or run: `ui.fault` to its plugin, then a redraw. */
  async function fault(
    instance: string,
    id: string,
    key: string,
    failure: { phase: 'load' | 'render' | 'run'; reason: string },
  ): Promise<boolean> {
    const client = clientIn(instance, id, key)
    if (!client) return false
    await deps.dispatch(
      'ui.fault',
      { ...client.at, ...failure },
      () => ({}),
      client.scene,
      client.own,
      CLIENT_ORIGIN,
    )
    // Its `ui.render` hook runs again, so it can leave the `Client` out.
    deps.changed()
    return true
  }

  /** A control used on screen: through its event, to the closure of the last drawing. */
  async function interact(instance: string, id: string, action: ControlAction): Promise<boolean> {
    const own = handlers.get(paneKey(instance, id))?.get(action.element)
    if (!own) return false
    const site = {
      plugin: deps.registry.pane(instance, id)?.plugin,
      component: 'Pane',
      requestId: id,
      surface: 'desktop' as const,
    }
    await runControl(own, site, action, (event, input, core) =>
      send(instance, event, input, core, id),
    )
    // What the control did is the mod's: the screen draws the pane again to see it.
    deps.changed()
    return true
  }

  return {
    render,
    interact,
    /** A pane the person closed: `ui.close` tells the mod, then it goes. */
    async close(instance: string, id: string): Promise<void> {
      let closed = false
      await send(
        instance,
        'ui.close',
        { id, origin: { kind: 'person' } },
        () => void (closed = true),
        id,
      )
      // A hook that answered without `next` keeps the pane open.
      if (!closed) return
      deps.registry.closePane(instance, id)
      handlers.delete(paneKey(instance, id))
      clients.delete(paneKey(instance, id))
    },
    forget(instance: string) {
      for (const map of [handlers, clients])
        for (const key of Array.from(map.keys()))
          if (key.startsWith(`${instance}\u0000`)) map.delete(key)
    },
    message,
    fault,
  }
}

/** Who raised a `Client`'s events: code on the screen, owned by its plugin. */
const CLIENT_ORIGIN: HookOrigin = { plugin: 'client', tier: 'user' }
