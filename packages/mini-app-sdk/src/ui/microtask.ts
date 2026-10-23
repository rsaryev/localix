export interface MicrotaskHost {
  queueMicrotask(callback: VoidFunction): void
}

/**
 * Queue browser work without detaching the Web-IDL method from its host.
 *
 * WebKit/Tauri brand-checks `Window.queueMicrotask`; a bare or copied function
 * can therefore throw "Can only call Window.queueMicrotask on instances of
 * Window". Keeping the property call preserves the receiver for host and plugin
 * UI code alike.
 */
export function enqueueMicrotask(callback: VoidFunction, host: MicrotaskHost = globalThis): void {
  host.queueMicrotask(callback)
}
