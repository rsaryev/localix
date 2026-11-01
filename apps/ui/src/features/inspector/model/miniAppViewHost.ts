import { miniAppViewTarget } from '@localixai/api/mini-app-view-target'
import { platformCapabilities } from '@/shared/lib/platformCapabilities'
import { scopeKindOf } from '@/entities/workspace-grid/model'
import type { PreviewCommand } from '@/shared/api/contracts'
import { miniAppLabel } from '@/shared/contrib/miniAppAttribution'
import { miniAppErrorBuffer, watchMiniAppErrors } from '@/shared/contrib/miniAppViewErrors'
import { railViewletRegistry, workItemKindRegistry } from '@/shared/contrib/uiContrib'
import { inspector } from '@/shared/lib/inspectorBus'
import { settle, visiblePanel, waitForPanel } from './miniAppViewPanel'
import type { ActuateResult, EmbeddedActuator } from '@localixai/visual-feedback/embedded'

/**
 * Run one agent `browser` command against a mini app's workbench view (`mini-app:<name>`).
 *
 * The chain, in the order it runs: WHICH view — the mini app's rail viewlet, which is what its own
 * launcher opens, or its only work-item kind; OPEN or focus it the way that launcher does, unless
 * it is already on screen; WAIT for a view it just opened to be laid out and quiet; RUN the command
 * through the embedded actuator scoped to that panel, reading the mini app's own error buffer as
 * its console; NAME the result after the view rather than the window around it.
 *
 * Some commands are refused, each for a reason the page case does not have: `evaluate` would run
 * in the Localix window itself, with everything the app can reach, not in a page the mini app owns;
 * `viewport` would resize a pane the person arranged; `back`, `forward` and `reload` would move
 * the Localix window itself, which is the one page a view has. Everything else is the browser's own
 * vocabulary, so the agent drives the mini app it built exactly as it drives a web page.
 */

interface MiniAppView {
  kind: string
  id: string
  title: string
}

export type MiniAppViewReply = ActuateResult

export function resolveMiniAppView(miniApp: string): MiniAppView | null {
  const viewlet = railViewletRegistry.list().find((entry) => entry.miniAppName === miniApp)
  if (viewlet) return { kind: viewlet.kind, id: viewlet.kind, title: viewlet.title }
  const kinds = workItemKindRegistry.list().filter((entry) => entry.miniAppName === miniApp)
  const only = kinds.length === 1 ? kinds[0] : undefined
  return only ? { kind: only.kind, id: only.kind, title: miniAppLabel(miniApp) } : null
}

/** The refusal a command earns before anything opens, or null when it may run. */
export function refusal(command: PreviewCommand): MiniAppViewReply | null {
  const asked = [command.action, ...(command.steps ?? []).map((step) => step.action)]
  if (asked.includes('evaluate'))
    return {
      ok: false,
      errorCode: 'bad_request',
      error:
        'evaluate is not available on a mini app view: it would run inside the Localix app, not in a page the mini app owns. Read the view with snapshot or take_screenshot, and the mini app with its own tools.',
    }
  if (command.action === 'viewport')
    return {
      ok: false,
      errorCode: 'bad_request',
      error: 'A mini app view fills the workbench pane it is open in; it has no viewport to set.',
    }
  if (command.action === 'back' || command.action === 'forward' || command.action === 'reload')
    return {
      ok: false,
      errorCode: 'bad_request',
      error: `${command.action} is not available on a mini app view: it has no page history, and the page around it is the Localix app. Open the view again, or use its own controls.`,
    }
  return null
}

function loadedViews(): string {
  const names = railViewletRegistry
    .list()
    .flatMap((entry) => (entry.miniAppName ? [entry.miniAppName] : []))
  return names.length ? ` Mini app views in this window: ${names.join(', ')}.` : ''
}

/**
 * Name what was read after the VIEW, not the window it sits in. The actuator describes its root's
 * document, which here is the whole app: snapshots were headed with the chat's title
 * and the app's URL, and the screenshot with the panel's CSS classes.
 */
function asView(
  reply: MiniAppViewReply,
  command: PreviewCommand,
  miniApp: string,
  view: MiniAppView,
): MiniAppViewReply {
  const result = reply.result
  if (!result) return reply
  const snapshot = result.snapshot && {
    ...result.snapshot,
    title: view.title,
    url: miniAppViewTarget(miniApp),
  }
  const whole = result.action === 'screenshot' && !command.ref && !command.selector
  return {
    ...reply,
    result: {
      ...result,
      ...(snapshot ? { snapshot } : {}),
      ...(whole ? { target: `${view.title} (${miniAppViewTarget(miniApp)})` } : {}),
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

function actuatorFor(miniApp: string): Promise<EmbeddedActuator> {
  let actuator = actuators.get(miniApp)
  if (!actuator) {
    // Loaded on the first look at any mini app view: the actuator and its rasterizer are not
    // something a window that never inspects a mini app should carry.
    actuator = import('@localixai/visual-feedback/embedded').then(({ createEmbeddedActuator }) =>
      createEmbeddedActuator({ console: miniAppErrorBuffer(miniApp), backdrop: paneBackdrop }),
    )
    actuators.set(miniApp, actuator)
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
function notOnScreen(view: MiniAppView): MiniAppViewReply {
  return {
    ok: false,
    errorCode: 'failed',
    error: `${view.title} belongs to each chat, and this chat is not the one on screen: the person is in another chat, so this chat's ${view.title} is not drawn and cannot be looked at now. Read it with the mini app's own tools instead.`,
  }
}

export async function runMiniAppViewCommand(
  miniApp: string,
  command: PreviewCommand,
  chat: CommandChat,
): Promise<MiniAppViewReply> {
  const refused = refusal(command)
  if (refused) return refused
  const view = resolveMiniAppView(miniApp)
  if (!view)
    return {
      ok: false,
      errorCode: 'not_found',
      error: `No workbench view of a mini app named "${miniApp}" is loaded in this window — it is not enabled, has no UI, or its UI failed to load.${loadedViews()}`,
    }
  const perChat = scopeKindOf(view.kind) === 'session'
  if (perChat && chat.activeSessionId !== chat.sessionId) return notOnScreen(view)
  const own = perChat ? chat.sessionId : undefined
  watchMiniAppErrors()
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
  if (native) return asView(native, command, miniApp, view)
  const actuator = await actuatorFor(miniApp)
  const reply = await actuator.run(command as Parameters<EmbeddedActuator['run']>[0], panel)
  return asView(reply, command, miniApp, view)
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
): Promise<MiniAppViewReply | null> {
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
