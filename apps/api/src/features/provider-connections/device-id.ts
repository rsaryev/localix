import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { localixHome } from '../../lib/env'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * ChatGPT sign-in refuses to produce an auth URL without an installation UUID.
 * Keep it in the machine home, independent of projects and individual login attempts,
 * and create it only when a provider asks. Exclusive creation preserves an existing ID.
 */
export function createDeviceIdGetter(file = join(localixHome(), 'oauth-device-id')): () => string {
  let cached: string | undefined
  return () => {
    if (cached) return cached
    let value: string
    try {
      value = readFileSync(file, 'utf8').trim()
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      mkdirSync(dirname(file), { recursive: true })
      value = randomUUID()
      try {
        writeFileSync(file, value, { flag: 'wx', mode: 0o600 })
      } catch (writeError) {
        if ((writeError as NodeJS.ErrnoException).code !== 'EEXIST') throw writeError
        value = readFileSync(file, 'utf8').trim()
      }
    }
    if (!UUID_PATTERN.test(value)) throw new Error('Stored OAuth installation ID is not a UUID')
    cached = value
    return value
  }
}
