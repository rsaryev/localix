import { createConsoleBuffer, type ConsoleBuffer } from '@localixai/visual-feedback/console-buffer'
import { attributeMiniAppCaller } from './miniAppAttribution'

/**
 * What went wrong in ONE plugin's UI, for the agent looking at that plugin's view.
 *
 * The browser tool's `console` returns the logs of the page it drives, captured by the page's
 * probe. A plugin's view is not a page: its code runs in the host window beside the whole app, so
 * the window's console is everyone's. What is the PLUGIN's is what its own code raised —
 * attributed the way plugin toasts are, by the artifact URL in the stack (`miniAppAttribution.ts`)
 * — plus the render crash its tab's boundary caught. One small buffer per plugin holds exactly
 * those.
 *
 * The window-wide hooks install on the first look at any plugin view (`watchMiniAppErrors`), so an
 * app that never inspects a plugin never pays for a stack on each console call. A render crash is
 * recorded regardless: it happens before anyone asks, and it is the error most worth reporting.
 */

const buffers = new Map<string, ConsoleBuffer>()

export function miniAppErrorBuffer(plugin: string): ConsoleBuffer {
  let buffer = buffers.get(plugin)
  if (!buffer) {
    buffer = createConsoleBuffer(30)
    buffers.set(plugin, buffer)
  }
  return buffer
}

export function recordMiniAppRenderCrash(plugin: string, surface: string, error: unknown): void {
  miniAppErrorBuffer(plugin).record('error', `${surface} could not render: ${describe(error)}`)
}

function describe(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}`
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

/** Record `text` against the plugin whose code any of `stacks` passes through, if one does. */
function attribute(level: 'error' | 'warn', text: string, stacks: readonly string[]): void {
  const caller = attributeMiniAppCaller(stacks.join('\n'))
  if (caller) miniAppErrorBuffer(caller.pluginName).record(level, text)
}

const stackOf = (value: unknown): string => (value instanceof Error ? (value.stack ?? '') : '')

let watching = false

export function watchMiniAppErrors(): void {
  if (watching || typeof window === 'undefined') return
  watching = true
  window.addEventListener('error', (event) =>
    attribute('error', event.message, [stackOf(event.error)]),
  )
  window.addEventListener('unhandledrejection', (event) =>
    attribute('error', `Unhandled rejection: ${describe(event.reason)}`, [stackOf(event.reason)]),
  )
  for (const level of ['error', 'warn'] as const) {
    const original = console[level]
    console[level] = (...args: unknown[]) => {
      // Two ways a log is the plugin's: its code made the call (this frame's stack), or it hands
      // over an error its code threw (React logging a caught render error does the latter).
      attribute(level, args.map(describe).join(' '), [
        new Error('plugin log call site').stack ?? '',
        ...args.map(stackOf),
      ])
      original.apply(console, args)
    }
  }
}
