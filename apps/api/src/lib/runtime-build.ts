import { createHash } from 'node:crypto'
import { statSync } from 'node:fs'

/**
 * Which BUILD of the API this process is executing — recorded in the runtime descriptor so
 * the desktop shell never attaches to a runtime from another build.
 *
 * `protocolVersion` answers "can this client talk to that runtime at all", and it moves
 * only on a breaking wire change. After an update the relaunched shell found the PREVIOUS
 * build's runtime still serving (a quit that had not finished, a crash of the old shell that
 * left its sidecar), saw a matching protocol and attached: the new UI then ran against old
 * code — old migrations, old tools, old bugs — until the machine rebooted.
 *
 * The API ships with no version stamped into it (the release workflow stamps only the Tauri
 * config), so the identity is taken from the entry module itself: the bundled `server.js`
 * of one build differs from the next in size and modification time. The PATH is left out on
 * purpose — an AppImage remounts at a new `/tmp/.mount_*` on every launch, and a moved app
 * bundle is the same build.
 */

let memo: string | undefined

/** Test seam: the entry to fingerprint. Production reads `Bun.main` once. */
export function computeRuntimeBuildId(entry: string): string {
  let identity = 'unknown'
  try {
    const stat = statSync(entry)
    identity = `${stat.size}:${Math.trunc(stat.mtimeMs)}`
  } catch {
    /* an unreadable entry is one build like any other; two of them compare equal */
  }
  return createHash('sha256').update(identity).digest('hex').slice(0, 16)
}

/** This process's build identity, fixed at first use so a replaced file cannot change it. */
export function runtimeBuildId(): string {
  memo ??= computeRuntimeBuildId(Bun.main)
  return memo
}

/** Is a published runtime THIS build? A descriptor from before the field never is. */
export function isSameBuild(endpoint: { buildId?: string }, own = runtimeBuildId()): boolean {
  return endpoint.buildId !== undefined && endpoint.buildId === own
}
