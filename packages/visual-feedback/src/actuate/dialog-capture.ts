/**
 * Dialog auto-dismiss — overrides `window.alert`/`confirm`/`prompt` with non-blocking
 * stubs while the probe is mounted.
 *
 * Motivation: a native dialog BLOCKS the JS event loop until the user
 * dismisses it. The probe drives the user's iframe preview through a postMessage bridge
 * — a blocking dialog freezes that bridge, so every subsequent `browser`
 * command returns "No open preview responded" until the user manually closes+reopens
 * the preview. An auto-dismissed + REPORTED dialog is strictly better for both agent and
 * user: the page keeps running, and the attempt is recorded into the console buffer so
 * it surfaces (via a drive action's `recentErrors`) on the very action that triggered it.
 *
 * Returns per the DOM contract: `alert` → undefined, `confirm` → true, `prompt` → null.
 * Defensive: no-op if there's no `window`, if already patched in this realm (re-inject),
 * or if assignment throws. Closure-free, no actuation deps — mirrors console-capture.ts.
 */

import type { ConsoleCapture } from './console-capture'
import { serializeEvalResult } from './evaluate'

/** Marker on `window` so a re-injected probe doesn't double-wrap the dialogs. */
const PATCHED_FLAG = '__vf_dialogs_patched'
const MAX_MESSAGE = 200

export interface DialogAutoDismiss {
  uninstall(): void
}

export function installDialogAutoDismiss(consoleCapture: ConsoleCapture): DialogAutoDismiss {
  const noop: DialogAutoDismiss = { uninstall() {} }
  try {
    if (typeof window === 'undefined') return noop
    const w = window as unknown as Record<string, unknown>
    if (w[PATCHED_FLAG]) return noop // already overridden (re-inject) — leave it be

    const original = { alert: window.alert, confirm: window.confirm, prompt: window.prompt }

    const record = (verb: 'alert' | 'confirm' | 'prompt', message?: unknown) => {
      const msg = message == null ? '' : serializeEvalResult(message)
      const shown = msg.length > MAX_MESSAGE ? `${msg.slice(0, MAX_MESSAGE - 1)}…` : msg
      consoleCapture.note(`[dialog] ${verb}(${JSON.stringify(shown)}) auto-dismissed`)
    }

    window.alert = (message?: unknown): void => {
      record('alert', message)
    }
    window.confirm = (message?: unknown): boolean => {
      record('confirm', message)
      return true
    }
    window.prompt = (message?: unknown): string | null => {
      record('prompt', message)
      return null
    }
    w[PATCHED_FLAG] = true

    return {
      uninstall() {
        try {
          window.alert = original.alert
          window.confirm = original.confirm
          window.prompt = original.prompt
          delete w[PATCHED_FLAG]
        } catch {
          /* noop */
        }
      },
    }
  } catch {
    return noop
  }
}
