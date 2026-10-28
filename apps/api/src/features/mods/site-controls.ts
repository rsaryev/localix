import {
  InvalidTreeError,
  serializeTree,
  type ElementHandlers,
  type JsonElement,
  type RenderChild,
} from '@localixai/claude-plugin/mods'

/**
 * What a drawn site (a pane, the band above the prompt) shares: its drawing as JSON with the
 * closures its controls carry kept here by the control's key, and a control used on screen sent
 * through its event (`ui.press`, `ui.input`, `ui.select`), whose core runs that closure with the
 * event as the chain left it — `onPress(e)`, `onInput(value, e)`, `onSubmit(value, e)`,
 * `onSelect(value, e)` — and answers as Claude Code's core does.
 */

export type ControlAction = {
  kind: 'press' | 'change' | 'submit' | 'select'
  element: string
  value?: string
}

/** The event fields every control's event carries: who drew it, where. */
export interface ControlSite {
  plugin: string | undefined
  component: string
  requestId: string
  surface: 'desktop'
}

type Send = (event: string, input: unknown, core: (e: unknown) => unknown) => Promise<unknown>

/** A site's drawing: what a `ui.render` hook answered, as JSON, or null with why. */
export function drawingOf(
  drawn: unknown,
  options: Parameters<typeof serializeTree>[1] = {},
):
  | {
      tree: Array<JsonElement | string>
      handlers: Map<string, ElementHandlers>
      clients: Map<string, string>
    }
  | { tree: null; problem?: string } {
  if (!drawn || (drawn as { type?: unknown }).type === 'engine') return { tree: null }
  try {
    const own = serializeTree(drawn as RenderChild, options)
    // A tree that draws nothing (the engine's own band, an empty Fragment) is no drawing.
    return own.tree.length === 0 ? { tree: null } : own
  } catch (error) {
    if (!(error instanceof InvalidTreeError)) throw error
    return { tree: null, problem: error.message }
  }
}

/** Run a control's event; its core calls the closure. */
export async function runControl(
  own: ElementHandlers,
  site: ControlSite,
  action: ControlAction,
  send: Send,
): Promise<void> {
  const value = action.value ?? ''
  const base = { ...site, element: action.element }
  if (action.kind === 'press')
    await send('ui.press', base, async (e) => {
      await own.onPress?.(e as never)
      return { element: action.element }
    })
  else if (action.kind === 'select')
    await send('ui.select', { ...base, value }, async (e) => {
      const picked = (e as { value: string }).value
      await own.onSelect?.(picked, e as never)
      return { element: action.element, value: picked }
    })
  else
    await send('ui.input', { ...base, kind: action.kind, value }, async (e) => {
      const typed = (e as { value: string }).value
      await (action.kind === 'submit' ? own.onSubmit : own.onInput)?.(typed, e as never)
      return { element: action.element, value: typed }
    })
}
