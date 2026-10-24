import { Fragment, h, type JsonElement, type TraceEntry } from '@localixai/claude-plugin/mods'
import { whileDrawing } from './api/state-api'
import type { RunSurface } from './api/run-api'
import { renderPages, type BandPage, type HeldPage } from './band-pages'
import type { ModScene } from './contracts'
import { runControl, type ControlAction } from './site-controls'

/**
 * The band above a conversation's prompt box: Claude Code's `AbovePrompt` render site, one
 * instance per conversation. Every mod in the conversation's project may draw it through
 * `ui.render` (`surface: 'desktop'`); the first loaded runs first, and `next(e)` hands it what
 * the mods after it drew, the engine's own band beneath being empty. A mod that answers without
 * `next` hides the mods after it; what they draw is offered as further pages (`band-pages.ts`).
 * Its controls work as a pane's (`site-controls.ts`), per page, their events and `$` calls in that
 * conversation, so a press can fill its prompt box. The screen draws it again on the `mods` poke.
 */

export interface BandViewport {
  columns: number
  rows: number
}

export interface BandDrawing {
  sessionId: string
  /** The first page's tree; null when no mod draws the band, or its drawing did not validate. */
  tree: Array<JsonElement | string> | null
  /** Every page, the chain as Claude Code runs it first; empty when nothing draws. */
  pages: BandPage[]
  problem?: string
}

/** A control used on screen, on the page that drew it (the first when absent). */
export type BandAction = ControlAction & { page?: number }

type Dispatch = (
  event: string,
  input: unknown,
  core: (event: unknown) => unknown,
  scene: ModScene,
  instances?: ReadonlySet<string>,
  origin?: undefined,
  signal?: undefined,
  onTrace?: (trace: readonly TraceEntry[], chain: readonly string[]) => void,
) => Promise<unknown>

/** The cells Claude Code keeps at the band's right end for its `[-]` mark. */
const MARK_COLUMNS = 5
/** What the engine draws in the band of its own: nothing. */
const EMPTY_BAND = () => h(Fragment, null)

export function createModBand(deps: {
  dispatch: Dispatch
  /** Where the conversation's latest turn ran, and with which instances. */
  joined: (sessionId: string) => { scene: ModScene; plugins: ReadonlySet<string> } | undefined
  /** The conversation's working directory, for one that ran no turn since Localix started. */
  sessionCwd: (scene: ModScene) => Promise<string | null>
  workspaceDir: string
  /** The instances of the loaded mods in a scene's project, started for it when not running. */
  start: (scene: ModScene) => Promise<ReadonlySet<string>>
  changed: () => void
}) {
  /** The running turn of each conversation with mods, lending them its tools (`isWorking`). */
  const running = new Map<string, RunSurface>()
  /**
   * Where a conversation's band runs: where its latest turn ran; for one that ran none since
   * Localix started, its own working directory, the mods loaded starting there for it.
   */
  async function sceneOf(sessionId: string) {
    const joined = deps.joined(sessionId)
    if (joined) return { scene: joined.scene, instances: joined.plugins }
    const fallback: ModScene = { userId: '', sessionId, cwd: deps.workspaceDir }
    const cwd = (await deps.sessionCwd(fallback).catch(() => null)) ?? deps.workspaceDir
    const scene = { ...fallback, cwd }
    return { scene, instances: await deps.start(scene) }
  }
  /** Each band's pages as last drawn, with their controls' closures. */
  const drawn = new Map<string, HeldPage[]>()

  async function render(sessionId: string, viewport: BandViewport): Promise<BandDrawing> {
    const { scene, instances } = await sceneOf(sessionId)
    const maxRows = Math.max(2, viewport.rows)
    const event = {
      component: 'AbovePrompt',
      surface: 'desktop',
      requestId: sessionId,
      props: {
        hasSurvey: false,
        isWorking: running.has(sessionId),
        maxRows,
        bodyColumns: Math.max(1, viewport.columns - MARK_COLUMNS),
        scroll: { bodyRows: maxRows - 1, offset: 0 },
        view: {},
      },
      viewport: { ...viewport, isFullscreen: false },
    }
    if (instances.size === 0) return { sessionId, tree: null, pages: [] }
    const { pages, problem } = await whileDrawing(`band\u0000${sessionId}`, () =>
      renderPages(instances, async (rest) => {
        const ran = { trace: [] as readonly TraceEntry[], chain: [] as readonly string[] }
        const onTrace = (trace: readonly TraceEntry[], chain: readonly string[]) =>
          void Object.assign(ran, { trace, chain })
        const drawn = await deps.dispatch(
          'ui.render',
          event,
          EMPTY_BAND,
          scene,
          rest,
          undefined,
          undefined,
          onTrace,
        )
        return { drawn, ...ran }
      }),
    )
    if (pages.length === 0) drawn.delete(sessionId)
    else drawn.set(sessionId, pages)
    return {
      sessionId,
      tree: pages[0]?.tree ?? null,
      pages: pages.map(({ mods, tree }) => ({ mods, tree })),
      ...(problem ? { problem } : {}),
    }
  }

  async function interact(sessionId: string, action: BandAction): Promise<boolean> {
    const { page: index = 0, ...control } = action
    const page = drawn.get(sessionId)?.[index]
    const own = page?.handlers.get(control.element)
    if (!page || !own) return false
    const { scene, instances } = await sceneOf(sessionId)
    const site = {
      plugin: page.owner,
      component: 'AbovePrompt',
      requestId: sessionId,
      surface: 'desktop' as const,
    }
    await runControl(own, site, control, (event, input, core) =>
      deps.dispatch(event, input, core, scene, instances),
    )
    deps.changed()
    return true
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
