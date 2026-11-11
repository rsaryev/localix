import { createHash } from 'node:crypto'
import type { HookReport, PaneInfo } from '@rsaryev/llx-plugin/mods'
import type { ModsHost as KitModsHost } from '@rsaryev/llx-plugin/mods'
import { MOD_LIMITS } from '../plugins/kit'
import { plainDataProblem } from '../plugins/kit/mods'
import { UnprocessableError } from '../../lib/domain-errors'
import {
  clientModuleOf,
  siteDrawing,
  routeScreenControl,
  type ControlAction,
  type HeldDrawing,
  type ScreenElement,
} from './site-drawing'

/**
 * A mod's panes on a Localix screen: the panes each conversation's mods host keeps
 * (`$.ui.open`), drawn by the kit at the `Pane` site on the `desktop` surface, every mod's hooks
 * able to restyle it. The drawing goes to the screen as plain data; its controls' callbacks stay
 * here, by pane and key, and a control used on screen is routed to them (`site-drawing.ts`). A
 * `Client` in a pane runs its surface module on the screen; what it posts comes back as
 * `ui.message`, and a failure as `ui.fault`, which only its own plugin's hooks hear.
 */

export interface PaneDrawing {
  /** Whose pane it is: its plugin in one conversation's (or the workspace's) mods host. */
  instance: string
  plugin: string
  id: string
  title?: string
  /** Null when no hook drew the pane, or its drawing was refused. */
  tree: Array<ScreenElement | string> | null
  problem?: string
}

export interface PaneViewport {
  columns: number
  rows: number
}

/** A mods host whose panes the screen shows: where it runs, by its key. */
export interface PaneHost {
  key: string
  cwd: string
  kit: KitModsHost
}

/** An open pane as the screen lists it. */
export interface PaneRef {
  instance: string
  plugin: string
  id: string
  title?: string
  cwd: string
  closeOnEscape: boolean
  /** Grows each time a listing finds the pane opened again asking for the keyboard. */
  focusRequest: number
}

/** A pane's owner as the screen names it: `<plugin>~<hash of its host>`. */
export const paneInstanceOf = (plugin: string, hostKey: string) =>
  `${plugin}~${createHash('sha256').update(hostKey).digest('hex').slice(0, 10)}`

export function createModPanes(deps: {
  hosts: () => readonly PaneHost[]
  changed: () => void
  /** The revision of a plugin's surface module, as the host bundled it. */
  clientRevision: (plugin: string, module: string) => string | undefined
  report: (report: HookReport) => void
  signal: AbortSignal
}) {
  const held = new Map<string, HeldDrawing>()
  const focus = new Map<string, { info: PaneInfo; count: number }>()
  const keyOf = (instance: string, id: string) => `${instance}\u0000${id}`
  /** Which bound a value a `Client` exchanges went past: a tree's own. */
  const tooLarge = (value: unknown) =>
    plainDataProblem(value, {
      maxDepth: MOD_LIMITS.treeDepth,
      maxNodes: MOD_LIMITS.treeNodes,
      maxChars: MOD_LIMITS.treeText,
    })

  function find(instance: string, id: string) {
    for (const host of deps.hosts())
      for (const info of host.kit.ui.panes.list())
        if (info.id === id && paneInstanceOf(info.plugin, host.key) === instance)
          return { host, info }
    return undefined
  }

  function list(): PaneRef[] {
    return deps.hosts().flatMap((host) =>
      host.kit.ui.panes.list().map((info) => {
        const instance = paneInstanceOf(info.plugin, host.key)
        const key = keyOf(instance, info.id)
        const before = focus.get(key)
        // A pane opened again is a new record: one that asks for the keyboard counts once more.
        const count =
          before?.info === info ? before.count : (before?.count ?? 0) + (info.request.focus ? 1 : 0)
        focus.set(key, { info, count })
        return {
          instance,
          plugin: info.plugin,
          id: info.id,
          ...(info.request.title !== undefined ? { title: info.request.title } : {}),
          cwd: host.cwd,
          closeOnEscape: info.request.closeOnEscape === true,
          focusRequest: count,
        }
      }),
    )
  }

  async function render(
    instance: string,
    id: string,
    viewport: PaneViewport = { columns: 100, rows: 40 },
  ): Promise<PaneDrawing | null> {
    const found = find(instance, id)
    if (!found) return null
    const { host, info } = found
    const title = info.request.title
    const drawn = await host.kit.ui.draw({
      site: 'Pane',
      surface: 'desktop',
      requestId: id,
      props: {
        title: title ?? id,
        isFocused: true,
        bodyColumns: viewport.columns,
        placement: 'dock',
        scroll: { bodyRows: viewport.rows, offset: 0 },
        // The main conversation's transcript is in view: Localix opens no agent's in its place.
        view: {},
      },
      viewport: { ...viewport, isFullscreen: false },
    })
    const drawing = siteDrawing(drawn, (module) => deps.clientRevision(info.plugin, module))
    const own = { instance, plugin: info.plugin, id, ...(title !== undefined ? { title } : {}) }
    if (drawing.screen === null) {
      held.delete(keyOf(instance, id))
      return { ...own, tree: null, ...(drawing.problem ? { problem: drawing.problem } : {}) }
    }
    held.set(keyOf(instance, id), drawing.held)
    return { ...own, tree: drawing.screen }
  }

  /** The drawn `Client` with `key` in a pane: its plugin's host, or null when it is not drawn. */
  function clientIn(instance: string, id: string, key: string) {
    const found = find(instance, id)
    const module = clientModuleOf(held.get(keyOf(instance, id)), key)
    return found && module !== undefined ? found : null
  }

  return {
    list,
    render,
    /** A control used on screen: through its event, to the callback of the last drawing. */
    async interact(instance: string, id: string, action: ControlAction): Promise<boolean> {
      const found = find(instance, id)
      const drawing = held.get(keyOf(instance, id))
      if (!found || !drawing) return false
      const used = await routeScreenControl(found.host.kit, drawing, action, deps)
      // What the control did is the mod's: the screen draws the pane again to see it.
      if (used) deps.changed()
      return used
    },
    /** What a `Client` posted: `ui.message` to its own plugin's hooks; a `{ props }` answer goes back. */
    async message(
      instance: string,
      id: string,
      key: string,
      data: unknown,
    ): Promise<{ props?: unknown } | null> {
      const client = clientIn(instance, id, key)
      if (!client) return null
      const problem = tooLarge(data)
      if (problem)
        throw new UnprocessableError(
          'mod_client_post_invalid',
          `The post is past a drawing's ${problem} limit`,
        )
      const answer = await client.host.kit.ui.message(client.info.plugin, data)
      const props = (answer as { props?: unknown } | null)?.props
      return props !== undefined && tooLarge(props) === undefined ? { props } : {}
    },
    /** A `Client` that failed to load, draw or run: `ui.fault` to its plugin, then a redraw. */
    async fault(
      instance: string,
      id: string,
      key: string,
      failure: { phase: 'load' | 'render' | 'run'; reason: string },
    ): Promise<boolean> {
      const client = clientIn(instance, id, key)
      if (!client) return false
      await client.host.kit.ui.fault(client.info.plugin, failure)
      return true
    },
    /** A pane the person closed: `ui.close` tells the mod, which may keep it open. */
    async close(instance: string, id: string): Promise<void> {
      const found = find(instance, id)
      if (!found) return
      if (await found.host.kit.ui.panes.close(id, 'person')) held.delete(keyOf(instance, id))
      deps.changed()
    },
  }
}

export type ModPanes = ReturnType<typeof createModPanes>
