import { promises as fs } from 'node:fs'
import { join } from 'node:path'

/**
 * Beside an installed app its marketplace took back (`revocations.ts`): which build, and why. It
 * lives in the app's folder, so the gate every host asks before importing an app's code
 * (`loadable.ts`) reads it with the manifest, and an update or a removal, which replace the
 * folder, take it away.
 */
export const REVOCATION_FILE = '.localix-revoked.json'

export interface RevocationMark {
  marketplace: string
  version: string
  reason: string
}

export async function readRevocation(dir: string): Promise<RevocationMark | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(join(dir, REVOCATION_FILE), 'utf8'))
    return typeof parsed?.reason === 'string' && parsed.reason
      ? {
          marketplace: String(parsed.marketplace ?? ''),
          version: String(parsed.version ?? ''),
          reason: parsed.reason,
        }
      : null
  } catch {
    return null
  }
}
