import { Fragment, h, type ElementHandlers, type JsonElement } from '@localixai/claude-plugin/mods'
import { whileDrawing } from './api/state-api'
import type { RunSurface } from './api/run-api'
import type { ModScene } from './contracts'
import { pluginOfInstance } from './instance-id'
import { drawingOf, runControl, type ControlAction } from './site-controls'

/**
 * The band above a conversation's prompt box: Claude Code's `AbovePrompt` render site, one
 * instance per conversation. Every mod in the conversation's project may draw it through
 * `ui.render` (`surface: 'desktop'`); the first loaded runs first, and `next(e)` hands it what
 * the mods after it drew, the engine's own band beneath being empty. Its controls work as a pane's
 * (`site-controls.ts`), their events and `$` calls in that conversation, so a press can fill its
 * prompt box. The screen draws it again on the `mods` poke.
 */

export interface BandViewport {
  columns: number
  rows: number
}

export interface BandDrawing {
  sessionId: string
  /** Null when no mod draws the band, or its drawing did not validate. */
  tree: Array<JsonElement | string> | null
  problem?: string
}

type Dispatch = (
  event: string,
  input: unknown,
  core: (event: unknown) => unknown,
  scene: ModScene,
  instances?: ReadonlySet<string>,
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
  const handlers = new Map<string, Map<string, ElementHandlers>>()
  /** Who drew each control of each band: the plugin its event names. */
  const owners = new Map<string, string | undefined>()

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
    if (instances.size === 0) return { sessionId, tree: null }
    const drawn = await whileDrawing(`band\u0000${sessionId}`, () =>
      deps.dispatch('ui.render', event, EMPTY_BAND, scene, instances),
    )
    const drawing = drawingOf(drawn)
    if (drawing.tree === null) {
      handlers.delete(sessionId)
      return { sessionId, tree: null, ...(drawing.problem ? { problem: drawing.problem } : {}) }
    }
    handlers.set(sessionId, (drawing as { handlers: Map<string, ElementHandlers> }).handlers)
    // Every mod there may draw into the band at once; its presses name the first one.
    const first = [...instances][0]
    owners.set(sessionId, first === undefined ? undefined : pluginOfInstance(first))
    return { sessionId, tree: drawing.tree }
  }

  async function interact(sessionId: string, action: ControlAction): Promise<boolean> {
    const own = handlers.get(sessionId)?.get(action.element)
    if (!own) return false
    const { scene, instances } = await sceneOf(sessionId)
    const site = {
      plugin: owners.get(sessionId),
      component: 'AbovePrompt',
      requestId: sessionId,
      surface: 'desktop' as const,
    }
    await runControl(own, site, action, (event, input, core) =>
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
