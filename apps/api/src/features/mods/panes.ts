import {
  InvalidTreeError,
  serializeTree,
  type ElementHandlers,
  type JsonElement,
  type RenderChild,
} from '@localixai/claude-plugin/mods'
import type { ModScene } from './contracts'
import type { ModRegistry } from './registry'

/**
 * A mod's panes on a Localix screen. A pane is drawn through `ui.render` with the `Pane` site (on
 * the `desktop` surface: Localix is a desktop app), every mod's hooks able to restyle it; the
 * drawing goes to the screen as JSON, and its controls' closures stay here, by pane and key. A
 * press, a typed value or a pick comes back through `ui.press`, `ui.input` or `ui.select`, whose
 * core runs that closure, as Claude Code's does.
 */

export interface PaneDrawing {
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
  scene?: ModScene,
  plugins?: ReadonlySet<string>,
) => Promise<unknown>

export interface PaneViewport {
  columns: number
  rows: number
}

export function createModPanes(deps: {
  dispatch: Dispatch
  registry: ModRegistry
  changed: () => void
}) {
  const handlers = new Map<string, Map<string, ElementHandlers>>()
  const paneKey = (plugin: string, id: string) => `${plugin}\u0000${id}`

  async function render(
    plugin: string,
    id: string,
    viewport: PaneViewport = { columns: 100, rows: 40 },
  ): Promise<PaneDrawing | null> {
    const pane = deps.registry.pane(plugin, id)
    if (!pane) return null
    const event = {
      component: 'Pane',
      surface: 'desktop',
      requestId: id,
      plugin,
      props: {
        title: pane.title ?? id,
        isFocused: true,
        bodyColumns: viewport.columns,
        placement: 'dock',
        scroll: { bodyRows: viewport.rows, offset: 0 },
      },
      viewport: { ...viewport, isFullscreen: false },
    }
    const drawn = await deps.dispatch('ui.render', event, () => ({ type: 'engine' }))
    if (!drawn || (drawn as { type?: unknown }).type === 'engine')
      return { plugin, id, title: pane.title, tree: null }
    try {
      const { tree, handlers: own } = serializeTree(drawn as RenderChild)
      handlers.set(paneKey(plugin, id), own)
      return { plugin, id, title: pane.title, tree }
    } catch (error) {
      if (!(error instanceof InvalidTreeError)) throw error
      return { plugin, id, title: pane.title, tree: null, problem: error.message }
    }
  }

  /** A control used on screen: through its event, to the closure of the last drawing. */
  async function interact(
    plugin: string,
    id: string,
    action: { kind: 'press' | 'input' | 'submit' | 'select'; element: string; value?: string },
  ): Promise<boolean> {
    const own = handlers.get(paneKey(plugin, id))?.get(action.element)
    if (!own) return false
    const value = action.value ?? ''
    const base = {
      plugin,
      element: action.element,
      component: 'Pane',
      surface: 'desktop',
      requestId: id,
    }
    if (action.kind === 'press')
      await deps.dispatch('ui.press', base, async () => {
        await own.onPress?.()
        return { element: action.element }
      })
    else if (action.kind === 'select')
      await deps.dispatch('ui.select', { ...base, value }, async (e) => {
        await own.onSelect?.((e as { value: string }).value)
        return { element: action.element, value }
      })
    else
      await deps.dispatch('ui.input', { ...base, kind: action.kind, value }, async (e) => {
        const typed = (e as { value: string }).value
        await (action.kind === 'submit' ? own.onSubmit : own.onInput)?.(typed)
        return { element: action.element, value: typed }
      })
    // What the control did is the mod's: the screen draws the pane again to see it.
    deps.changed()
    return true
  }

  return {
    render,
    interact,
    /** A pane the person closed: `ui.close` tells the mod, then it goes. */
    async close(plugin: string, id: string): Promise<void> {
      await deps.dispatch('ui.close', { id, origin: { kind: 'person' } }, () => ({}))
      deps.registry.closePane(plugin, id)
      handlers.delete(paneKey(plugin, id))
    },
    forget(plugin: string) {
      for (const key of Array.from(handlers.keys()))
        if (key.startsWith(`${plugin}\u0000`)) handlers.delete(key)
    },
  }
}

export type ModPanes = ReturnType<typeof createModPanes>
