import type { ModInterface as KitModInterface } from '@rsaryev/llx-plugin/mods'
import type { ModScene, ModsPorts } from '../contracts'
import type { ModComposer } from '../composer'
import { copyToClipboard } from '../api/clipboard'
import type { RunTools } from './run-tools'

/**
 * The interface the kit's mods draw on, as Localix shows it: the desktop app, through the
 * conversation's notices, its prompt box's status line and the `mods` poke that has clients
 * re-read the panes. A question goes on the running turn's card; Localix has no selection,
 * raster or transcript view a mod can drive, so those calls are refused with the reason.
 */

export interface SessionInterfaceDeps {
  ports: Pick<ModsPorts, 'log' | 'notify' | 'changed'>
  scene: ModScene
  composer: ModComposer
  /** `$.ui.invalidate(event)`: the event's kept answers go (`answer-cache.ts`). */
  rerun: (event: string) => void
  /** The running turn's question card (`$.ui.ask`). */
  turn?: Pick<RunTools, 'ask'>
}

/** The mod a kit status or log line names: `⚠ <mod>: ` or `● <mod>: ` starts it. */
const modOf = (line: string) => /^\S+ ([^:]+): /.exec(line)?.[1] ?? ''

/** What the desktop leaves to the person: the call is refused with the reason. */
const denied = (reason: string) => async () => ({ deny: reason })

const textOf = (value: unknown) => (typeof value === 'string' ? value : JSON.stringify(value))

export function createSessionInterface(deps: SessionInterfaceDeps): KitModInterface {
  const { ports, scene, composer } = deps
  return {
    surface: () => 'desktop',
    // The desktop app measures no grid of cells for a mod.
    viewport: () => undefined,
    renderer: () => 'fullscreen',
    origin: () => 'mod',
    drawsPlacedRows: () => false,
    redraw: () => ports.changed(),
    rerun(event) {
      deps.rerun(event)
      ports.changed()
    },
    isTerminalVisible: () => false,
    status(line) {
      if (scene.sessionId) composer.status(scene.sessionId, modOf(line), line)
    },
    log: (line) => ports.log(scene, { plugin: modOf(line), text: line }),
    async notify({ text, title }) {
      ports.notify(scene, { plugin: title, text, tone: 'info' })
      return { isSent: true, channel: 'desktop' }
    },
    ask: (request) =>
      deps.turn?.ask(request) ??
      Promise.reject(new Error('No turn is running in this conversation')),
    copy: (text) => copyToClipboard(text),
    // The window's selection stays in the window: none reaches a mod.
    selection: async () => undefined,
    // A note under one tool call's card in Claude Code; a line in the conversation here, which
    // names no mod: the kit hands the interface the call's tool and text alone.
    async notice(request) {
      if (request.text !== undefined)
        ports.log(scene, { plugin: 'mods', text: textOf(request.text) })
    },
    scroll: denied('Localix scrolls a pane as the person does'),
    focus: denied('Localix moves focus as the person does'),
    blit: denied('the desktop surface draws no terminal raster'),
    view: denied('Localix moves the view only on the person’s own input'),
  }
}
