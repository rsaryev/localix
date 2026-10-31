/**
 * Scoped dialog guard for a native page, which is also the person's own browsing.
 *
 * A native `alert`/`confirm`/`prompt` blocks the page until someone answers it, and an agent
 * command running in the page would wait on it for good. So while a command is in flight, and only
 * then, the three are answered by cancelling (`alert` → undefined, `confirm` → false,
 * `prompt` → null: never accepting) and the text is noted into the console buffer, where it rides
 * the command's reply. Outside a command the call goes to the page's own dialog, unchanged.
 *
 * The wrappers delegate with the caller's `this` and arguments, so a page that reads or patches
 * them sees ordinary functions. See dialog-capture.ts for the iframe probe's always-on variant.
 */

import type { ConsoleCapture } from './console-capture'
import { serializeEvalResult } from './evaluate'

const MAX_MESSAGE = 200

export interface ScopedDialogGuard {
  /** Cancel dialogs until the returned function is called (idempotent). Holds nest. */
  hold(): () => void
  uninstall(): void
}

export function installScopedDialogGuard(consoleCapture: ConsoleCapture): ScopedDialogGuard {
  const noop: ScopedDialogGuard = { hold: () => () => {}, uninstall() {} }
  try {
    if (typeof window === 'undefined') return noop
    const original = { alert: window.alert, confirm: window.confirm, prompt: window.prompt }
    let held = 0

    const note = (verb: string, message: unknown) => {
      let text = ''
      try {
        text = message == null ? '' : serializeEvalResult(message)
      } catch {
        /* an unreadable message is still a dialog */
      }
      const shown = text.length > MAX_MESSAGE ? `${text.slice(0, MAX_MESSAGE - 1)}…` : text
      consoleCapture.note(`[dialog] ${verb}(${JSON.stringify(shown)}) cancelled`)
    }

    window.alert = function (this: unknown, ...args: unknown[]) {
      if (held > 0) return void note('alert', args[0])
      return (original.alert as (...a: unknown[]) => void).apply(this, args)
    } as typeof window.alert
    window.confirm = function (this: unknown, ...args: unknown[]) {
      if (held > 0) return (note('confirm', args[0]), false)
      return (original.confirm as (...a: unknown[]) => boolean).apply(this, args)
    } as typeof window.confirm
    window.prompt = function (this: unknown, ...args: unknown[]) {
      if (held > 0) return (note('prompt', args[0]), null)
      return (original.prompt as (...a: unknown[]) => string | null).apply(this, args)
    } as typeof window.prompt

    return {
      hold() {
        held += 1
        let released = false
        return () => {
          if (released) return
          released = true
          held -= 1
        }
      },
      uninstall() {
        try {
          window.alert = original.alert
          window.confirm = original.confirm
          window.prompt = original.prompt
        } catch {
          /* noop */
        }
      },
    }
  } catch {
    return noop
  }
}
