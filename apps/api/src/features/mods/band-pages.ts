import type { ElementHandlers, JsonElement, TraceEntry } from '@localixai/claude-plugin/mods'
import { pluginOfInstance } from './instance-id'
import { drawingOf } from './site-controls'

/**
 * The band's pages. In Claude Code a `ui.render` hook that answers without calling `next(e)`
 * replaces what the mods after it would draw; that stays the band's first page. The mods it hid
 * may still have something to say, so the band draws the rest of the chain again from the mod
 * after the one that cut it, and again after the next cut, as further pages the person can reach.
 * Which mods are hidden is read only from the chain's trace — who called `next` — never from which
 * mod it is. A hidden mod that draws nothing adds no page.
 */

/** Pages at most, the first included; each is one more run of the chain, with its own budgets. */
export const MAX_BAND_PAGES = 4

export interface BandPage {
  /** The plugins whose hooks drew on this page, outermost first. */
  mods: string[]
  tree: Array<JsonElement | string>
}

/** A page as the host keeps it: its controls' closures and whose presses they are. */
export interface HeldPage extends BandPage {
  handlers: Map<string, ElementHandlers>
  owner: string | undefined
}

/** One run of the chain over `instances`: what it drew, the links that ran, its hooks' mods. */
export type RenderChain = (instances: ReadonlySet<string>) => Promise<{
  drawn: unknown
  trace: readonly TraceEntry[]
  chain: readonly string[]
}>

/**
 * The mods a hook that answered without `next` kept from running: those of the hooks after it in
 * the chain, the engine's own link absent from the trace. None when the chain reached the engine.
 */
function hiddenBy(trace: readonly TraceEntry[], chain: readonly string[]) {
  const last = trace.at(-1)
  if (!last || last.plugin === 'engine') return null
  const after = chain.slice(last.index + 1).filter((instance) => instance !== last.plugin)
  return { cutter: last.plugin, hidden: [...new Set(after)] }
}

/** The plugins that drew something of their own: their hook answered with a value it made. */
function drawersOf(trace: readonly TraceEntry[]): string[] {
  const drew = trace
    .filter((link) => link.outcome === 'returned' || link.outcome === 'caught')
    .filter((link) => link.plugin !== 'engine')
    .map((link) => pluginOfInstance(link.plugin))
  return [...new Set(drew)]
}

/**
 * Every page of the band: the chain over all `instances`, then, while a hook cut it, the chain
 * over the mods that hook hid. `problem` is why the first run's drawing failed.
 */
export async function renderPages(
  instances: ReadonlySet<string>,
  render: RenderChain,
): Promise<{ pages: HeldPage[]; problem?: string }> {
  const pages: HeldPage[] = []
  let problem: string | undefined
  let rest: ReadonlySet<string> = instances
  for (let run = 0; run < MAX_BAND_PAGES && rest.size > 0; run++) {
    const { drawn, trace, chain } = await render(rest)
    const cut = hiddenBy(trace, chain)
    const drawing = drawingOf(drawn)
    if (drawing.tree !== null) {
      const drew = drawersOf(trace)
      const mods = drew.length > 0 ? drew : [pluginOfInstance(cut?.cutter ?? [...rest][0]!)]
      const { tree, handlers } = drawing as {
        tree: HeldPage['tree']
        handlers: HeldPage['handlers']
      }
      pages.push({ mods, tree, handlers, owner: mods[0] })
    } else if (run === 0 && 'problem' in drawing && drawing.problem) problem = drawing.problem
    if (!cut) break
    rest = new Set(cut.hidden)
  }
  return { pages, ...(problem ? { problem } : {}) }
}
