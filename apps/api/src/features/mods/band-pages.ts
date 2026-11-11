import type { DispatchTrace, Drawn } from '@rsaryev/llx-plugin/mods'
import { siteDrawing, type HeldDrawing, type ScreenElement } from './site-drawing'

/**
 * The band's pages. In Claude Code a `ui.render` hook that answers without calling `next(e)`
 * replaces what the mods after it would draw; that stays the band's first page. The mods it hid
 * may still have something to say, so the band draws the rest of the chain again from the mod
 * after the one that cut it, and again after the next cut, as further pages the person can reach.
 * Which mods are hidden is read only from the chain's trace (the kit's `DispatchTrace`: which
 * hooks answered, and whether Claude Code's own drawing was reached), never from which mod it is.
 * A hidden mod that draws nothing adds no page.
 */

/** Pages at most, the first included; each is one more run of the chain, with its own budgets. */
export const MAX_BAND_PAGES = 4

export interface BandPage {
  /** The mods whose hooks drew on this page, outermost first. */
  mods: string[]
  tree: Array<ScreenElement | string>
}

/** A page as the host keeps it: its controls' callbacks and whose presses they are. */
export interface HeldPage extends BandPage {
  held: HeldDrawing
  owner: string | undefined
}

/** One run of the chain over the mods `only`: what it drew, and its trace. */
export type RenderChain = (only: ReadonlySet<string>) => Promise<{
  drawn: Drawn | { readonly problem: string }
  trace: DispatchTrace | undefined
}>

/**
 * The mods a hook that answered without `next` kept from running: those of the hooks after it in
 * the chain. None when the chain reached Claude Code's own drawing.
 */
function hiddenBy(trace: DispatchTrace | undefined) {
  const last = trace?.steps.at(-1)
  if (!trace || !last || last.plugin === 'engine') return null
  const after = trace.chain.slice(last.index + 1).filter((mod) => mod !== last.plugin)
  return { cutter: last.plugin, hidden: [...new Set(after)] }
}

/** The mods that drew something of their own: their hook answered with a value it made. */
function drawersOf(trace: DispatchTrace | undefined): string[] {
  const drew = (trace?.steps ?? [])
    .filter((step) => step.outcome === 'returned' && step.plugin !== 'engine')
    .map((step) => step.plugin)
  return [...new Set(drew)]
}

/**
 * Every page of the band: the chain over all `mods`, then, while a hook cut it, the chain over the
 * mods that hook hid. `problem` is why the first run's drawing failed.
 */
export async function renderPages(
  mods: ReadonlySet<string>,
  render: RenderChain,
): Promise<{ pages: HeldPage[]; problem?: string }> {
  const pages: HeldPage[] = []
  let problem: string | undefined
  let rest: ReadonlySet<string> = mods
  for (let run = 0; run < MAX_BAND_PAGES && rest.size > 0; run++) {
    const { drawn, trace } = await render(rest)
    const cut = hiddenBy(trace)
    const drawing = siteDrawing(drawn)
    if (drawing.screen !== null) {
      const drew = drawersOf(trace)
      const owners = drew.length > 0 ? drew : [cut?.cutter ?? [...rest][0]!]
      pages.push({ mods: owners, tree: drawing.screen, held: drawing.held, owner: owners[0] })
    } else if (run === 0 && drawing.problem) problem = drawing.problem
    if (!cut) break
    rest = new Set(cut.hidden.filter((mod) => rest.has(mod)))
  }
  return { pages, ...(problem ? { problem } : {}) }
}
