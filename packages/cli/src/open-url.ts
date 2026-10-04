/**
 * Pure helpers for the `open` command — resolving a user-supplied path to an
 * absolute path, turning it into a `localix://open?path=…` deep link that the
 * running desktop app (single-instance) picks up, and wording the outcome. Kept
 * pure so all of it is unit-testable.
 *
 * The OS dispatch itself is NOT here: handing a target to the platform's scheme
 * handler is `@localixai/os-open`, the one table this repo's Bun/Node surfaces
 * share. The CLI used to carry its own copy, which is how the same three-row
 * table came to exist three times with three different failure semantics.
 */

import { isAbsolute, resolve } from 'node:path'

/**
 * Resolve a raw CLI path argument to an absolute path.
 *   `.` / `` (empty)  → the current working directory
 *   `~` / `~/x`       → the home directory (POSIX shells usually expand this, but
 *                       quoting or `localix "~/x"` can leave it literal)
 *   relative          → resolved against `cwd`
 *   absolute          → returned as-is (normalized)
 * `cwd` and `home` are injected so the function is pure + testable.
 */
export function resolveOpenPath(rawArg: string, cwd: string, home: string): string {
  const arg = rawArg.trim()
  if (arg === '' || arg === '.') return cwd
  if (arg === '~') return home
  if (arg === '~/' || arg.startsWith('~/') || arg.startsWith('~\\')) {
    return resolve(home, arg.slice(2))
  }
  if (isAbsolute(arg)) return resolve(arg)
  return resolve(cwd, arg)
}

/** Build the `localix://open?path=…[&new=1]` deep link for an absolute path. */
export function buildOpenUrl(absPath: string, fresh = false): string {
  const params = new URLSearchParams({ path: absPath })
  if (fresh) params.set('new', '1')
  return `localix://open?${params.toString()}`
}

/**
 * The user-facing message after attempting to open a path in the desktop app.
 * `ok` = the scheme opener succeeded (the app handled it); otherwise the app
 * likely isn't installed, so we point the user at installing it — with whatever
 * the opener itself said appended, when it said anything. Pure so the wording is
 * unit-tested; the command just writes it.
 */
export function openOutcomeMessage(
  absPath: string,
  ok: boolean,
  reason?: string,
): { stream: 'stdout' | 'stderr'; text: string } {
  if (ok) return { stream: 'stdout', text: `  →  Opening ${absPath} in Localix…\n` }
  return {
    stream: 'stderr',
    text:
      `\n  ✗  Could not reach the Localix desktop app.\n` +
      `     Install and start it — it registers the \`localix://\` handler.\n` +
      // What the opener actually said, when it said anything. "Could not reach"
      // alone sends everyone to the same install page, including the person whose
      // real problem was something else entirely.
      (reason ? `     ${reason}\n` : '') +
      `\n`,
  }
}
