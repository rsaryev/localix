import { createHash, randomBytes } from 'node:crypto'

import { sealedPreimage, type Sealed } from '../sealed'

/**
 * Commit `owner` to `value`: a fresh random salt and the digest over both, unrevealed. The salt makes
 * a short value (one of three moves) impossible to recover from the digest by trying them all.
 */
export function seal(value: string, owner: string, at: string): Sealed {
  const salt = randomBytes(16).toString('hex')
  const digest = createHash('sha256').update(sealedPreimage(value, salt)).digest('hex')
  return { owner, value, salt, digest, sealedAt: at, revealedAt: null }
}
