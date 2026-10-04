// Thin access to the global Tauri bridge (tauri.conf.json `withGlobalTauri: true`
// exposes @tauri-apps/api under window.__TAURI__). Kept dependency-free so the UI
// never has to import Tauri npm packages — outside the desktop shell every call
// is simply absent and callers no-op.

type InvokeFn = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>

export type DesktopInvokePhase = 'started' | 'succeeded' | 'failed'
export interface DesktopInvokeEvent {
  traceId: string
  command: string
  phase: DesktopInvokePhase
  ts: number
  durationMs?: number
  error?: unknown
}
type DesktopInvokeEventHandler = (event: DesktopInvokeEvent) => void

const desktopInvokeEventHandlers = new Set<DesktopInvokeEventHandler>()
let desktopInvokeSequence = 0

function emitDesktopInvokeEvent(event: DesktopInvokeEvent): void {
  for (const handler of desktopInvokeEventHandlers) {
    try {
      handler(event)
    } catch (error) {
      // Instrumentation observes the native bridge; it must never change whether
      // the underlying command succeeds or fails.
      console.error('[tauri] invoke observer threw', error)
    }
  }
}

type UnlistenFn = () => void
type ListenFn = (
  event: string,
  handler: (event: { payload: unknown }) => void,
) => Promise<UnlistenFn>

interface TauriWindowHandle {
  isFullscreen(): Promise<boolean>
  /**
   * Set the app-wide badge count on the dock (macOS) / taskbar-adjacent icon
   * (Linux). `undefined` clears it. Unsupported on Windows (no-ops there).
   * Available since @tauri-apps/api 2.2.0. App-wide, not per-window.
   */
  setBadgeCount(count?: number): Promise<void>
}

interface TauriGlobal {
  core?: { invoke?: InvokeFn }
  event?: { listen?: ListenFn }
  window?: { getCurrentWindow?: () => TauriWindowHandle }
}

function tauriGlobal(): TauriGlobal | undefined {
  if (typeof window === 'undefined') return undefined
  return (window as unknown as { __TAURI__?: TauriGlobal }).__TAURI__
}

/**
 * The Tauri `invoke` function, or undefined when not running under the desktop
 * shell. Call a Rust command with `tauriInvoke()?.('cmd', { …args })`.
 */
export function tauriInvoke(): InvokeFn | undefined {
  const invoke = tauriGlobal()?.core?.invoke
  return invoke ? observeDesktopInvoke(invoke) : undefined
}

/** Wrap one bridge implementation; exported so tests need not replace global window. */
export function observeDesktopInvoke(invoke: InvokeFn): InvokeFn {
  return async (command, args) => {
    const traceId = `native-${++desktopInvokeSequence}`
    const startedAt = Date.now()
    emitDesktopInvokeEvent({
      traceId,
      command,
      phase: 'started',
      ts: startedAt,
    })
    try {
      const result = await invoke(command, args)
      const ts = Date.now()
      emitDesktopInvokeEvent({
        traceId,
        command,
        phase: 'succeeded',
        ts,
        durationMs: ts - startedAt,
      })
      return result
    } catch (error) {
      const ts = Date.now()
      emitDesktopInvokeEvent({
        traceId,
        command,
        phase: 'failed',
        ts,
        durationMs: ts - startedAt,
        error,
      })
      throw error
    }
  }
}

/** Observer-only native transport seam; command arguments are intentionally absent. */
export function onDesktopInvokeEvent(handler: DesktopInvokeEventHandler): () => void {
  desktopInvokeEventHandlers.add(handler)
  return () => desktopInvokeEventHandlers.delete(handler)
}

export function resetDesktopInvokeEventsForTests(): void {
  desktopInvokeEventHandlers.clear()
  desktopInvokeSequence = 0
}

/** Best-effort diagnostic mirrored into the packaged shell log. */
export function tauriFrontendLog(scope: string, message: string): void {
  void tauriInvoke()?.('frontend_log', { scope, message }).catch(() => {})
}

/**
 * The Tauri `event.listen` function, or undefined when not running under the
 * desktop shell. Subscribe to a Rust-emitted event with
 * `tauriListen()?.('name', (e) => …)` — the resolved promise is the unlisten fn.
 */
export function tauriListen(): ListenFn | undefined {
  return tauriGlobal()?.event?.listen
}

/** The current Tauri window handle, or undefined outside the desktop shell. */
export function tauriCurrentWindow(): TauriWindowHandle | undefined {
  return tauriGlobal()?.window?.getCurrentWindow?.()
}
