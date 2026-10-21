import { pluginViewTarget } from '@localixai/api/plugin-view-target'
import { platformCapabilities } from '@/shared/lib/platformCapabilities'
import { isTabOpenedAs, scopeKindOf } from '@/entities/workspace-grid/model'
import type { PreviewCommand } from '@/shared/api/contracts'
import { pluginLabel } from '@/shared/contrib/pluginAttribution'
import { pluginErrorBuffer, watchPluginErrors } from '@/shared/contrib/pluginViewErrors'
import { railViewletRegistry, workItemKindRegistry } from '@/shared/contrib/uiContrib'
import { inspector } from '@/shared/lib/inspectorBus'
import type { ActuateResult, EmbeddedActuator } from '@localixai/visual-feedback/embedded'

/**
 * Run one agent `browser` command against a plugin's workbench view (`plugin:<name>`).
 *
 * The chain, in the order it runs: WHICH view — the plugin's rail viewlet, which is what its own
 * launcher opens, or its only work-item kind; OPEN or focus it the way that launcher does, unless
 * it is already on screen; WAIT for a view it just opened to be laid out and quiet; RUN the command
 * through the embedded actuator scoped to that panel, reading the plugin's own error buffer as its
 * console; NAME the result after the view rather than the window around it.
 *
 * Two commands are refused, each for a reason the page case does not have: `evaluate` would run
 * in the Localix window itself, with everything the app can reach, not in a page the plugin owns;
 * `viewport` would resize a pane the person arranged. Everything else is the browser's own
 * vocabulary, so the agent drives the plugin it built exactly as it drives a web page.
 */

interface PluginView {
  kind: string
  id: string
  title: string
}

export type PluginViewReply = ActuateResult

const PANEL_TIMEOUT_MS = 6_000
const QUIET_MS = 300
const SETTLE_CAP_MS = 4_000

export function resolvePluginView(plugin: string): PluginView | null {
  const viewlet = railViewletRegistry.list().find((entry) => entry.pluginName === plugin)
  if (viewlet) return { kind: viewlet.kind, id: viewlet.kind, title: viewlet.title }
  const kinds = workItemKindRegistry.list().filter((entry) => entry.pluginName === plugin)
  const only = kinds.length === 1 ? kinds[0] : undefined
  return only ? { kind: only.kind, id: only.kind, title: pluginLabel(plugin) } : null
}

/** The refusal a command earns before anything opens, or null when it may run. */
export function refusal(command: PreviewCommand): PluginViewReply | null {
  const asked = [command.action, ...(command.steps ?? []).map((step) => step.action)]
  if (asked.includes('evaluate'))
    return {
      ok: false,
      errorCode: 'bad_request',
      error:
        'evaluate is not available on a plugin view: it would run inside the Localix app, not in a page the plugin owns. Read the view with snapshot or take_screenshot, and the plugin with its own tools.',
    }
  if (command.action === 'viewport')
    return {
      ok: false,
      errorCode: 'bad_request',
      error: 'A plugin view fills the workbench pane it is open in; it has no viewport to set.',
    }
  return null
}

function loadedViews(): string {
  const names = railViewletRegistry
    .list()
    .flatMap((entry) => (entry.pluginName ? [entry.pluginName] : []))
  return names.length ? ` Plugin views in this window: ${names.join(', ')}.` : ''
}

/**
 * The panel of the tab opened as `id` that is on screen. A plugin's session tab carries its
 * session in its id (`tabIdInScope`), and only the active session's is visible — so the visible
 * one is the view in front of the person, never another chat's hidden copy.
 */
function visiblePanel(id: string, chat?: string): HTMLElement | null {
  const selector = `[data-slot="tab-panel"][data-work-item-id^="${CSS.escape(id)}"]`
  // For a per-chat view only THIS chat's tab counts (or the unqualified one, which is no other
  // chat's); "opened as" alone also matches `<id>@<any chat>`.
  const ours = (tabId: string) =>
    chat === undefined ? isTabOpenedAs(tabId, id) : tabId === id || tabId === `${id}@${chat}`
  for (const panel of document.querySelectorAll<HTMLElement>(selector)) {
    if (!ours(panel.dataset.workItemId ?? '')) continue
    const box = panel.getBoundingClientRect()
    if (!panel.hidden && box.width > 0 && box.height > 0) return panel
  }
  return null
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

async function waitForPanel(id: string, chat?: string): Promise<HTMLElement | null> {
  const deadline = performance.now() + PANEL_TIMEOUT_MS
  for (;;) {
    const panel = visiblePanel(id, chat)
    if (panel || performance.now() > deadline) return panel
    await delay(50)
  }
}

/**
 * Resolve once the panel's STRUCTURE has gone QUIET_MS without a change, or at the cap. A view
 * that just opened is a loading hint, then its first render, then its first poll's answer; a
 * command run in the middle of that reads a page that is about to change under it.
 *
 * Only elements arriving and leaving count. A view that shows time changes its text and its
 * progress bar's width many times a second, forever: counting those, a snapshot of a
 * running timer waited out the whole cap on every call.
 */
function settle(panel: HTMLElement): Promise<void> {
  return new Promise((resolve) => {
    const timers: { quiet?: ReturnType<typeof setTimeout>; cap?: ReturnType<typeof setTimeout> } =
      {}
    const observer = new MutationObserver(() => {
      clearTimeout(timers.quiet)
      timers.quiet = setTimeout(done, QUIET_MS)
    })
    function done() {
      observer.disconnect()
      clearTimeout(timers.quiet)
      clearTimeout(timers.cap)
      resolve()
    }
    observer.observe(panel, { subtree: true, childList: true })
    timers.quiet = setTimeout(done, QUIET_MS)
    timers.cap = setTimeout(done, SETTLE_CAP_MS)
  })
}

/**
 * Name what was read after the VIEW, not the window it sits in. The actuator describes its root's
 * document, which here is the whole app: snapshots were headed with the chat's title
 * and the app's URL, and the screenshot with the panel's CSS classes.
 */
function asView(
  reply: PluginViewReply,
  command: PreviewCommand,
  plugin: string,
  view: PluginView,
): PluginViewReply {
  const result = reply.result
  if (!result) return reply
  const snapshot = result.snapshot && {
    ...result.snapshot,
    title: view.title,
    url: pluginViewTarget(plugin),
  }
  const whole = result.action === 'screenshot' && !command.ref && !command.selector
  return {
    ...reply,
    result: {
      ...result,
      ...(snapshot ? { snapshot } : {}),
      ...(whole ? { target: `${view.title} (${pluginViewTarget(plugin)})` } : {}),
    },
  }
}

/** The opaque ground a JPEG needs: under the macOS glass theme every pane is translucent. */
function paneBackdrop(): string | undefined {
  const styles = getComputedStyle(document.documentElement)
  return (
    styles.getPropertyValue('--background-solid').trim() ||
    styles.getPropertyValue('--background').trim() ||
    undefined
  )
}

const actuators = new Map<string, Promise<EmbeddedActuator>>()

function actuatorFor(plugin: string): Promise<EmbeddedActuator> {
  let actuator = actuators.get(plugin)
  if (!actuator) {
    // Loaded on the first look at any plugin view: the actuator and its rasterizer are not
    // something a window that never inspects a plugin should carry.
    actuator = import('@localixai/visual-feedback/embedded').then(({ createEmbeddedActuator }) =>
      createEmbeddedActuator({ console: pluginErrorBuffer(plugin), backdrop: paneBackdrop }),
    )
    actuators.set(plugin, actuator)
  }
  return actuator
}

/** The chat that sent the command, and the chat on screen in this window. */
export interface CommandChat {
  sessionId: string
  activeSessionId: string | null
}

/**
 * A SESSION-scoped view is drawn once per chat, and only the active chat's copy is on screen. An
 * agent working in a background chat therefore opened — and screenshotted — the view of the chat
 * the person was in: the agent "checked" its board and saw another chat's empty one. The command
 * is answered from its own chat's tab or not at all; bringing that chat to the front would take
 * the person's screen away from them, so the refusal says what to read instead.
 */
function notOnScreen(view: PluginView): PluginViewReply {
  return {
    ok: false,
    errorCode: 'failed',
    error: `${view.title} belongs to each chat, and this chat is not the one on screen: the person is in another chat, so this chat's ${view.title} is not drawn and cannot be looked at now. Read it with the plugin's own tools instead.`,
  }
}

export async function runPluginViewCommand(
  plugin: string,
  command: PreviewCommand,
  chat: CommandChat,
): Promise<PluginViewReply> {
  const refused = refusal(command)
  if (refused) return refused
  const view = resolvePluginView(plugin)
  if (!view)
    return {
      ok: false,
      errorCode: 'not_found',
      error: `No workbench view of a plugin named "${plugin}" is loaded in this window — it is not enabled, has no UI, or its UI failed to load.${loadedViews()}`,
    }
  const perChat = scopeKindOf(view.kind) === 'session'
  if (perChat && chat.activeSessionId !== chat.sessionId) return notOnScreen(view)
  const own = perChat ? chat.sessionId : undefined
  watchPluginErrors()
  // Already on screen, it is already rendered: waiting for it to settle would only add latency to
  // every command on an open view.
  const shown = visiblePanel(view.id, own)
  // Opened in the command's own chat — the one just checked to be on screen — not stamped later
  // with whichever chat the grid happens to focus.
  if (!shown)
    inspector.openWorkItem({
      workKind: view.kind,
      id: view.id,
      title: view.title,
      scope: own ?? null,
    })
  const panel = shown ?? (await waitForPanel(view.id, own))
  if (!panel)
    return {
      ok: false,
      errorCode: 'failed',
      error: `${view.title} was opened but its tab did not become visible in the workbench.`,
    }
  if (!shown) await settle(panel)
  const native = await nativePanelShot(command, panel)
  if (native) return asView(native, command, plugin, view)
  const actuator = await actuatorFor(plugin)
  const reply = await actuator.run(command as Parameters<EmbeddedActuator['run']>[0], panel)
  return asView(reply, command, plugin, view)
}

/**
 * A whole-view screenshot in the desktop app, taken from the compositor (`workbench_snapshot`).
 *
 * The DOM rasterizer re-renders the panel by cloning it and inlining every element's computed
 * style, all on the page's one thread: a large board — a few thousand nodes of code cards,
 * diagrams and handles — froze the whole app, and the agent's call timed out with the window
 * still stuck. The pixels are already on screen; the shell copies them. Null (so the rasterizer
 * runs) outside the desktop app, for an element-scoped shot, or when the shell cannot capture.
 */
async function nativePanelShot(
  command: PreviewCommand,
  panel: HTMLElement,
): Promise<PluginViewReply | null> {
  if (command.action !== 'screenshot' || command.ref || command.selector) return null
  const invoke = platformCapabilities().desktop.invoker()
  if (!invoke) return null
  const rect = panel.getBoundingClientRect()
  try {
    const image = await invoke('workbench_snapshot', {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    })
    if (!isImage(image)) return null
    return {
      ok: true,
      result: {
        action: 'screenshot',
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        image,
      },
    }
  } catch {
    return null
  }
}

function isImage(
  value: unknown,
): value is { data: string; mediaType: string; width: number; height: number } {
  const image = value as Record<string, unknown> | null
  return (
    typeof image?.data === 'string' &&
    typeof image.mediaType === 'string' &&
    typeof image.width === 'number' &&
    typeof image.height === 'number'
  )
}
