/**
 * The AES master key for an at-rest vault — ONE owner for both of them.
 *
 * The secrets vault and the MCP OAuth store each had their own copy of this function,
 * and both copies carried the same two defects, which is the argument for this file:
 * a security-critical routine that exists twice gets fixed once. (The OAuth store's
 * header already said "same scheme as the secrets vault" — the scheme just wasn't
 * shared code.)
 *
 * The key decrypts everything in its vault, so REPLACING it is not a recovery: it
 * makes every stored value undecryptable forever, silently. Creating one is therefore
 * allowed for exactly one reason — there is no file yet — and every other outcome
 * throws.
 *
 * Both old routes to "fall through and create" were reachable:
 *   - a transient read failure (EACCES, EIO) is not "no key yet", and it minted a
 *     replacement over a perfectly good key;
 *   - the write was a plain writeFile, so a crash mid-write left a short file, which
 *     failed the 32-byte check on the next boot and was ALSO answered by generating a
 *     new key — an interrupted first write destroyed the vault it was creating.
 * temp+rename means the file is either absent or a complete key, never a stub, and
 * 0600 rides the temp so the key never exists world-readable.
 */
import { mkdir, readFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import path from 'node:path'

import { atomicWriteFile } from '@localixai/mini-app-sdk/backend'

/** Load `<dir>/.masterkey`, creating a random 0600 one ONLY when there is no file. */
export async function loadOrCreateMasterKey(dir: string): Promise<Buffer> {
  const file = path.join(dir, '.masterkey')
  let b64: string | null = null
  try {
    b64 = await readFile(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException | null)?.code !== 'ENOENT') throw error
  }
  if (b64 !== null) {
    const key = Buffer.from(b64.trim(), 'base64')
    if (key.length === 32) return key
    throw new Error(
      `Master key ${file} is present but malformed (${key.length} bytes, expected 32). ` +
        'Refusing to replace it — a new key would make every stored value permanently ' +
        'undecryptable. Restore the file, or move it aside to start a fresh vault.',
    )
  }
  await mkdir(dir, { recursive: true })
  const key = randomBytes(32)
  await atomicWriteFile(file, key.toString('base64'), { mode: 0o600 })
  return key
}
