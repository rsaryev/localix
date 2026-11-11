import type { Drawn, ElementNode, HookReport, Props, TreeChild } from '@rsaryev/llx-plugin/mods'
import type { ModsHost as KitModsHost } from '@rsaryev/llx-plugin/mods'
import {
  controlKey,
  isElementNode,
  joinHandlers,
  routeControl,
  splitHandlers,
} from '../plugins/kit/mods'

/**
 * What a drawn site on a Localix screen (a pane, the band above the prompt) shares: the kit's
 * drawing as plain data for the screen, its controls' callbacks kept here by key
 * (`splitHandlers`), and a control used on screen put back on the tree (`joinHandlers`) and routed
 * through its event (`ui.press`, `ui.input`, `ui.select`) to its callback, as Claude Code does.
 */

/**
 * One element as the screen gets it: the kit's element as plain data, Claude Code's own drawing
 * left out, and a `Client`'s surface module named by its revision (a new revision is new code).
 */
export type ScreenElement = Omit<ElementNode, 'children'> & {
  children: Array<ScreenElement | string>
  client?: { revision: string }
}

/** A drawing kept for its controls: the plain tree and each control's callbacks, by key. */
export interface HeldDrawing {
  tree: ElementNode
  handlers: ReadonlyMap<string, Props>
}

export type SiteDrawing =
  | { screen: Array<ScreenElement | string>; held: HeldDrawing }
  | { screen: null; problem?: string }

/** A control used on screen. */
export type ControlAction = {
  kind: 'press' | 'change' | 'submit' | 'select'
  element: string
  value?: string
}

function screenOf(
  node: ElementNode,
  revisionOf: (module: string) => string | undefined,
): ScreenElement {
  const children = node.children.flatMap((child: TreeChild): Array<ScreenElement | string> =>
    typeof child === 'string' ? [child] : isElementNode(child) ? [screenOf(child, revisionOf)] : [],
  )
  const module = node.type === 'Client' ? node.props.module : undefined
  const revision = typeof module === 'string' ? revisionOf(module) : undefined
  // A control is used on screen by its key: a button's is its label when it sets none.
  const key = controlKey(node)
  const props = key === undefined || node.props.key === key ? node.props : { ...node.props, key }
  return { type: node.type, props, children, ...(revision ? { client: { revision } } : {}) }
}

/** What the screen draws of a site the kit drew; null when no mod drew it, with why it failed. */
export function siteDrawing(
  drawn: Drawn | { readonly problem: string },
  revisionOf: (module: string) => string | undefined = () => undefined,
): SiteDrawing {
  if ('problem' in drawn) return { screen: null, problem: drawn.problem }
  if ('refused' in drawn) return { screen: null, problem: drawn.line }
  if (!('tree' in drawn)) return { screen: null }
  const held = splitHandlers(drawn.tree)
  return { screen: [screenOf(held.tree, revisionOf)], held }
}

/** The surface module of the `Client` drawn with `key`, or undefined when none is. */
export function clientModuleOf(held: HeldDrawing | undefined, key: string): string | undefined {
  const visit = (node: ElementNode): string | undefined => {
    if (node.type === 'Client' && node.props.key === key && typeof node.props.module === 'string')
      return node.props.module
    for (const child of node.children)
      if (isElementNode(child)) {
        const found = visit(child)
        if (found !== undefined) return found
      }
    return undefined
  }
  return held ? visit(held.tree) : undefined
}

/** A control used on screen, through its event to the callback of the drawing it was used on. */
export async function routeScreenControl(
  kit: KitModsHost,
  held: HeldDrawing,
  action: ControlAction,
  context: { signal: AbortSignal; report: (report: HookReport) => void },
): Promise<boolean> {
  const routed = await routeControl(
    {
      chain: kit.chain,
      tree: joinHandlers(held.tree, held.handlers),
      surface: 'desktop',
      ...context,
    },
    action.kind,
    action.element,
    action.value ?? '',
  )
  return routed.issues.length === 0 || routed.ran
}
