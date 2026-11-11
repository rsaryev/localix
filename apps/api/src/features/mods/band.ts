import type { DispatchTrace, HookReport } from '@rsaryev/llx-plugin/mods'
import type { ModsHost as KitModsHost } from '@rsaryev/llx-plugin/mods'
import { ENGINE_ORIGIN, foldRender, renderEvent } from '../plugins/kit/mods'
import { renderPages, type BandPage, type HeldPage } from './band-pages'
import type { RunSurface } from './session/run-tools'
import { routeScreenControl, type ControlAction, type ScreenElement } from './site-drawing'

/**
 * The band above a conversation's prompt box: Claude Code's `AbovePrompt` render site, one per
 * conversation. Every mod of the conversation may draw it through `ui.render`
 * (`surface: 'desktop'`); the first loaded runs first, and `next(e)` hands it Claude Code's own
 * band beneath, which draws nothing. A mod that answers without `next` hides the mods after it;
 * what they draw is offered as further pages (`band-pages.ts`). Its controls work as a pane's
 * (`site-drawing.ts`), per page, their events and `$` calls in that conversation, so a press can
 * fill its prompt box. The screen draws it again on the `mods` poke.
 */

export interface BandViewport {
  columns: number
  rows: number
}

export interface BandDrawing {
  sessionId: string
  /** The first page's tree; null when no mod draws the band, or its drawing was refused. */
  tree: Array<ScreenElement | string> | null
  /** Every page, the chain as Claude Code runs it first; empty when nothing draws. */
  pages: BandPage[]
  /** The conversation's turn is running (`isWorking`): the screen holds its page still. */
  working: boolean
  problem?: string
}

/** A control used on screen, on the page that drew it (the first when absent). */
export type BandAction = ControlAction & { page?: number }

/** The cells Claude Code keeps at the band's right end for its `[-]` mark. */
const MARK_COLUMNS = 5

export function createModBand(deps: {
  /** The conversation's mods host, loaded for it when it is not yet. */
  hostOf: (sessionId: string) => Promise<KitModsHost | undefined>
  changed: () => void
  report: (report: HookReport) => void
  signal: AbortSignal
}) {
  /** The running turn of each conversation with mods, lending them its tools (`isWorking`). */
  const running = new Map<string, RunSurface>()
  /** Each band's pages as last drawn, with their controls' callbacks. */
  const drawn = new Map<string, HeldPage[]>()

  async function render(sessionId: string, viewport: BandViewport): Promise<BandDrawing> {
    const kit = await deps.hostOf(sessionId)
    const working = running.has(sessionId)
    const mods = new Set((kit?.active() ?? []).map((mod) => mod.name))
    const maxRows = Math.max(2, viewport.rows)
    const built = renderEvent({
      site: 'AbovePrompt',
      surface: 'desktop',
      props: {
        hasSurvey: false,
        isWorking: working,
        maxRows,
        bodyColumns: Math.max(1, viewport.columns - MARK_COLUMNS),
        scroll: { bodyRows: maxRows - 1, offset: 0 },
        view: {},
      },
      viewport: { ...viewport, isFullscreen: false },
    })
    if (!kit || mods.size === 0 || 'problem' in built)
      return { sessionId, tree: null, pages: [], working }
    const { pages, problem } = await renderPages(mods, async (only) => {
      let trace: DispatchTrace | undefined
      const settled = await kit.chain.dispatch('ui.render', built.event, {
        origin: ENGINE_ORIGIN,
        signal: deps.signal,
        report: deps.report,
        only,
        trace: (ran) => void (trace = ran),
        // Claude Code's own band, which draws nothing.
        core: (e) => Promise.resolve({ type: 'engine', ref: e }),
      })
      return { drawn: foldRender('AbovePrompt', 'desktop', settled), trace }
    })
    if (pages.length === 0) drawn.delete(sessionId)
    else drawn.set(sessionId, pages)
    return {
      sessionId,
      tree: pages[0]?.tree ?? null,
      working,
      pages: pages.map(({ mods: own, tree }) => ({ mods: own, tree })),
      ...(problem ? { problem } : {}),
    }
  }

  async function interact(sessionId: string, action: BandAction): Promise<boolean> {
    const { page: index = 0, ...control } = action
    const page = drawn.get(sessionId)?.[index]
    const kit = page ? await deps.hostOf(sessionId) : undefined
    if (!page || !kit) return false
    const used = await routeScreenControl(kit, page.held, control, deps)
    if (used) deps.changed()
    return used
  }

  return {
    render,
    interact,
    /** A turn lends its tools while it runs; the band redraws as one starts and ends. */
    runs: {
      attach(sessionId: string, surface: RunSurface) {
        running.set(sessionId, surface)
        deps.changed()
      },
      detach(sessionId: string) {
        if (running.delete(sessionId)) deps.changed()
      },
      get: (sessionId: string) => running.get(sessionId),
    },
  }
}

export type ModBand = ReturnType<typeof createModBand>
