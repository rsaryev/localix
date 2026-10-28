import { elementTable } from '@localixai/claude-plugin/mods'
import type { ModComposer } from '../composer'
import { stringOr, type ModScene, type ModsPorts } from '../contracts'
import type { ModRegistry } from '../registry'
import { copyToClipboard } from './clipboard'

/**
 * `$.ui` on Localix's desktop surface: panes as workspace tabs, the conversation's status line and
 * notices, a question card, the clipboard. What the desktop leaves to the person — scrolling,
 * focus, the view — or does not draw — a terminal raster — answers Claude Code's `{ deny }`.
 */

/** A screen call Claude Code answers with `{ deny }` when the surface cannot do it. */
const denied = (reason: string) => () => ({ deny: reason })

const textOf = (input: unknown) =>
  typeof input === 'string' ? input : stringOr((input as { text?: unknown } | null)?.text)

export function createUiApi(deps: {
  plugin: string
  instance: string
  scene: () => ModScene
  ports: ModsPorts
  registry: ModRegistry
  composer: ModComposer
  tableOf: (component: string) => ReturnType<typeof elementTable> | undefined
  invalidate: (event: unknown) => void
  ask: (question: unknown, options?: unknown) => Promise<unknown>
}) {
  const { plugin, instance, scene, ports, registry } = deps
  /**
   * `$.ui.open`: the pane opens as a workspace tab of its own. One that asks for the keyboard
   * (`focus`) opens focused, so it is placed; one that does not opens as a background tab, undrawn
   * until the person brings it forward, as Claude Code's waits undrawn.
   */
  const open = (args: unknown) => {
    const pane = (args ?? {}) as Record<string, unknown>
    for (const flag of ['focus', 'closeOnEscape', 'holdToasts'])
      if (flag in pane && pane[flag] !== true)
        throw new Error(`ui.open: ${flag} is true or left out`)
    for (const size of ['rows', 'columns'])
      if (size in pane && !(Number.isInteger(pane[size]) && (pane[size] as number) > 0))
        throw new Error(`ui.open: ${size} is a positive whole number or left out`)
    const sessionId = scene().sessionId
    registry.openPane(instance, {
      id: pane.id as string,
      ...(typeof pane.title === 'string' ? { title: pane.title } : {}),
      ...(sessionId ? { sessionId } : {}),
      ...(pane.closeOnEscape === true ? { closeOnEscape: true } : {}),
      focus: pane.focus === true,
    })
    return pane.focus === true
      ? { isPlaced: true }
      : {
          isPlaced: false,
          reason: 'opens as a background tab, drawn when the person brings it forward',
        }
  }
  return {
    resolve: (e?: { component?: unknown }) =>
      (typeof e?.component === 'string' ? deps.tableOf(e.component) : undefined) ?? elementTable(),
    invalidate: (event: unknown) => deps.invalidate(event),
    open,
    close: (pane: { id: string } | string) =>
      registry.closePane(instance, typeof pane === 'string' ? pane : pane.id),
    // A pane asked forward is placed and shown in its tab; focus is the person's to give.
    panes: () =>
      registry.panes(instance).map((pane) => ({
        id: pane.id,
        title: pane.title ?? pane.id,
        isShown: pane.focusRequest > 0,
        isFocused: false,
        isPlaced: pane.focusRequest > 0,
      })),
    toast: (text: unknown) => ports.notify(scene(), { plugin, text: textOf(text), tone: 'info' }),
    // A notification is the terminal's channel; the desktop has none, as in Claude Code's desktop
    // app, so a mod falls back to a toast (`if (!r.isSent) $.ui.toast(text)`).
    notify: () => ({ isSent: false, reason: 'no-surface' }),
    // The conversation's status line, a line per mod, as Claude Code's status bar shows it.
    status: (text: unknown) => {
      const sessionId = scene().sessionId
      if (sessionId)
        deps.composer.status(sessionId, plugin, text == null ? undefined : textOf(text))
    },
    // `{ to: 'debug' }` keeps the line off the transcript.
    log: (text: unknown, options?: { to?: unknown }) =>
      options?.to === 'debug' ? undefined : ports.log(scene(), { plugin, text: textOf(text) }),
    // A note under one tool call's card in Claude Code; a line in the conversation here.
    notice: (_toolUseId: unknown, text: unknown) =>
      text === undefined ? undefined : ports.log(scene(), { plugin, text: textOf(text) }),
    scroll: denied('Localix scrolls a pane as the person does'),
    focus: denied('Localix moves focus as the person does'),
    blit: denied('the desktop surface draws no terminal raster'),
    ask: deps.ask,
    copy: (args: { text?: unknown }) => copyToClipboard(textOf(args)),
    // The window's selection stays in the window: none reaches a mod.
    selection: () => undefined,
    view: denied('Localix moves the view only on the person’s own input'),
  }
}
