/**
 * Probe entry — self-mounting glue bundled to an IIFE by the API and injected into
 * the previewed page. It wires the picker + overlay + source resolver + transport,
 * announces `ready`, and reacts to host commands. NO UI chrome of its own beyond
 * the outline (the rich composer + comment list live natively in the host).
 *
 * Config is read from the script's own URL query / dataset (set by the injector):
 *   ?vf_file=<servedFile>
 */

import { VF_IGNORE_ATTR, VF_PROTOCOL_VERSION, type VfMode } from '../protocol/index'
import { motionSafeScrollBehavior } from '../core/motion'
import { createResolverChain } from '../source/index'
import { createOverlay } from '../overlay/index'
import { createPicker } from '../selection/fsm'
import { createProbeTransport } from '../transport/postmessage'
import { buildCapture } from './capture'
import { createRefRegistry } from '../snapshot/index'
import { installConsoleCapture, runCommand, type ActuateDeps } from '../actuate/index'
import { createReloadTracker, safeSessionStorage } from '../actuate/reload-detect'
import { installResourceErrorCapture } from '../actuate/resource-errors'
import { installDialogAutoDismiss } from '../actuate/dialog-capture'
import { attachFailedResources } from '../actuate/attach-failed-resources'

interface ProbeConfig {
  servedFile?: string
}

function readConfig(): ProbeConfig {
  // The injector sets these on the script tag it adds.
  const script =
    (document.currentScript as HTMLScriptElement | null) ??
    document.querySelector('script[data-vf-probe]')
  const ds = script?.dataset ?? {}
  return {
    servedFile: ds.vfFile || undefined,
  }
}

function applyThemeVars(vars: Record<string, string>): void {
  const root = document.documentElement
  for (const [k, v] of Object.entries(vars)) {
    // ONLY our namespaced `--vf-*` vars (overlay accent). Never set generic names
    // like `--primary`/`--background` — that would clobber the previewed app's own
    // CSS variables (e.g. a shadcn app) and visually restyle it.
    if (/^--vf-[\w-]+$/.test(k)) root.style.setProperty(k, v)
  }
}

function mount(): () => void {
  const cfg = readConfig()
  const resolveSource = createResolverChain({
    servedFile: cfg.servedFile,
  })
  const transport = createProbeTransport(window.parent)
  // The composer follows the selection: its rect goes to the host whenever it moves, and once as
  // null when the selection goes, rather than on every scroll whether anything is selected or not.
  let sentRect = 'null'
  const overlay = createOverlay({
    onLayout: () => {
      const rect = overlay.activeRect()
      const key = JSON.stringify(rect)
      if (key === sentRect) return
      sentRect = key
      transport.send({ type: 'active-rect', rect })
    },
  })
  const cursor = commentCursor()

  let mode: VfMode = 'off'
  // The element just picked: hovering it again would stack the hover outline on the selection.
  let picked: Element | null = null

  // Agent-control state: a ref registry (eN → element, rebuilt each snapshot), a
  // console ring buffer, and the last interactive tree for action diffs. A FRESH
  // registry per probe mount is exactly what makes a post-reload ref resolve to null
  // (not a detached pre-reload node) — the actuator then self-heals + reports the
  // reload, never dispatching on a stale element while claiming success.
  const actuate: ActuateDeps = {
    reg: createRefRegistry(),
    console: installConsoleCapture(),
    prevTree: { value: '' },
  }

  // Reload detection: flags the first agent command of a fresh page load that
  // followed prior agent activity (a mid-session dev-server auto-reload / reload) so
  // the tool can warn the agent the DOM was reset. See reload-detect.ts.
  const reloadTracker = createReloadTracker(safeSessionStorage())

  // Subresource-failure capture: a 404'd stylesheet/script leaves the page silently
  // broken (the unstyled-theme mystery). Surfaced on every snapshot, and —
  // NEW-since-last-command — on diff-only drive results (see reportedResources below).
  const resourceErrors = installResourceErrorCapture()

  // Failures already surfaced to the agent (a snapshot's full list or a prior diff
  // result) — a diff-only drive result then reports only what's NEW since.
  const reportedResources = new Set<string>()

  // Native dialogs (alert/confirm/prompt) BLOCK the JS event loop; inside the probe's
  // iframe that freezes the postMessage bridge, so every later command times out with
  // "No open preview responded" until the user closes+reopens the preview.
  // Override them with non-blocking stubs that record the attempt into the console
  // buffer — so it rides the triggering action's `recentErrors` — instead of hanging.
  const dialogs = installDialogAutoDismiss(actuate.console)

  const picker = createPicker({
    // Hover is purely visual: the probe draws the outline in-page; the host doesn't
    // need per-move messages.
    onHover: (el) => {
      if (el !== picked) picked = null
      overlay.setHover(picked ? null : el)
    },
    onMarquee: (rect) => overlay.setMarquee(rect),
    onPick: (ev) => {
      let capture
      try {
        capture = buildCapture(ev, resolveSource)
      } catch (err) {
        // A pathological DOM could make describe-logic throw; report it instead of
        // silently swallowing the click (the probe runs in the preview's own realm,
        // so this is the host's only window into the failure).
        transport.send({
          type: 'error',
          message: `pick failed: ${err instanceof Error ? err.message : String(err)}`,
        })
        return
      }
      if (!capture) return
      picked = ev.element
      overlay.setHover(null)
      overlay.setActive(
        ev.page
          ? null
          : ev.kind === 'area' || ev.kind === 'multi'
            ? { area: capture.rect, members: ev.members }
            : ev.element
              ? { element: ev.element }
              : null,
      )
      transport.send({ type: 'selected', capture })
    },
    // A click on something already commented opens that comment rather than starting a second
    // one on the same element.
    onPickMarked: (el) => {
      const mark = overlay.markOf(el)
      if (!mark) return false
      picked = el
      overlay.setHover(null)
      overlay.setActive({ element: el })
      transport.send({ type: 'open-mark', id: mark.id, rect: overlay.activeRect()! })
      return true
    },
  })

  // Esc while commenting (iframe has focus) → tell the host to leave comment mode,
  // the standard exit for an inspect/pick mode. (A focused host composer catches Esc
  // itself; this covers the case where focus is in the page.)
  const onKeyDown = (e: KeyboardEvent) => {
    if (mode === 'comment' && e.key === 'Escape') {
      // Own Esc while commenting (like the swallowed clicks) so it doesn't also
      // trigger the previewed app's own Esc handlers (closing its modals, etc.).
      e.preventDefault()
      e.stopPropagation()
      transport.send({ type: 'escape' })
    }
  }
  window.addEventListener('keydown', onKeyDown, true)

  const offHost = transport.onHost((msg) => {
    switch (msg.type) {
      case 'set-mode':
        mode = msg.mode
        picker.setEnabled(mode === 'comment')
        cursor.set(mode === 'comment')
        if (mode === 'off') {
          overlay.setActive(null)
          overlay.setHover(null)
          picked = null
        }
        break
      case 'theme':
        applyThemeVars(msg.vars)
        break
      case 'set-marks':
        overlay.setMarks(msg.marks ?? [])
        break
      case 'reveal': {
        let el: Element | null = null
        try {
          el = msg.selector ? document.querySelector(msg.selector) : null
        } catch {
          el = null
        }
        if (el) {
          el.scrollIntoView({ behavior: motionSafeScrollBehavior('smooth'), block: 'center' })
          overlay.setActive({ element: el })
          overlay.pulse()
        }
        break
      }
      case 'command': {
        // Agent-driven control: execute one command and reply with the result,
        // keyed by the same commandId so the host can resolve its pending promise.
        // Async because `screenshot` rasterizes the element in-page.
        void runCommand(msg.command, actuate).then((r) => {
          // Stamp the reload flag onto the result (synthesizing a minimal one when a
          // bare failure carries none) so the agent is told the DOM was reset.
          const reloaded = reloadTracker.consume()
          let result = reloaded
            ? { ...(r.result ?? { action: msg.command.action }), reloaded: true }
            : r.result
          // Surface failed page subresources: the FULL list on a snapshot-bearing result,
          // or only NEW-since-last-command failures on a diff-only drive result.
          result = attachFailedResources(result, resourceErrors.read(), reportedResources)
          transport.send({
            type: 'command-result',
            commandId: msg.commandId,
            ok: r.ok,
            result,
            error: r.error,
            errorCode: r.errorCode,
          })
        })
        break
      }
      case 'clear':
        overlay.setActive(null)
        picked = null
        break
    }
  })

  transport.send({ type: 'ready', channelId: transport.channelId, version: VF_PROTOCOL_VERSION })

  return () => {
    offHost()
    picker.destroy()
    overlay.destroy()
    transport.destroy()
    actuate.console.uninstall()
    resourceErrors.uninstall()
    dialogs.uninstall()
    window.removeEventListener('keydown', onKeyDown, true)
    cursor.set(false)
  }
}

/**
 * The crosshair while commenting, as a stylesheet: set inline on `<html>` it lost to every element
 * that declares its own cursor — every link and button on the page.
 */
function commentCursor(): { set(on: boolean): void } {
  const style = document.createElement('style')
  style.setAttribute(VF_IGNORE_ATTR, '')
  style.textContent = '*, *::before, *::after { cursor: crosshair !important; }'
  return {
    set(on) {
      if (on && !style.isConnected) document.head?.appendChild(style)
      if (!on) style.remove()
    },
  }
}

// Guard against double-injection (e.g. re-served HTML in the same realm).
const FLAG = '__vf_probe_mounted'
const w = window as unknown as Record<string, boolean | undefined>
if (!w[FLAG]) {
  w[FLAG] = true
  // Mark our injected <script> so hit-testing can ignore it too.
  document.currentScript?.setAttribute(VF_IGNORE_ATTR, '')
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => void mount())
  } else {
    mount()
  }
}
