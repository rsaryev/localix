import { promises as fs } from 'node:fs'
import { createHash } from 'node:crypto'

import { InvalidRequestError, UnprocessableError } from '../../lib/domain-errors'
import { rmrf } from '../ext/install-tree'

/** Compressed tarball ceiling; extraction has separate manifest/install validation. */
export const MAX_NPM_TARBALL_BYTES = 50 * 1024 * 1024

/** Verify tarball bytes against `dist.integrity` (SRI) or the legacy sha1 `shasum`. */
export function verifyNpmIntegrity(
  pkg: string,
  data: Uint8Array,
  dist: { integrity?: string; shasum?: string },
): void {
  const check = npmIntegrityCheck(dist)
  if (!check) return
  const got = createHash(check.algorithm).update(data).digest(check.encoding)
  assertNpmIntegrity(pkg, check.expected, got)
}

interface NpmIntegrityCheck {
  algorithm: 'sha512' | 'sha384' | 'sha256' | 'sha1'
  expected: string
  encoding: 'base64' | 'hex'
}

function npmIntegrityCheck(dist: {
  integrity?: string
  shasum?: string
}): NpmIntegrityCheck | null {
  const sri = dist.integrity?.split(/\s+/).find((p) => /^(sha512|sha384|sha256|sha1)-/.test(p))
  if (sri) {
    const separator = sri.indexOf('-')
    return {
      algorithm: sri.slice(0, separator) as NpmIntegrityCheck['algorithm'],
      expected: sri.slice(separator + 1),
      encoding: 'base64',
    }
  }
  return dist.shasum
    ? { algorithm: 'sha1', expected: dist.shasum.toLowerCase(), encoding: 'hex' }
    : null
}

function assertNpmIntegrity(pkg: string, expected: string, got: string): void {
  if (got !== expected) {
    throw new UnprocessableError(
      'plugin_npm_integrity',
      `npm tarball for "${pkg}" failed integrity verification (expected ${expected}, got ${got}).`,
    )
  }
}

/** Stream a tarball to disk with a hard byte ceiling and incremental integrity hash. */
export async function downloadNpmTarball(
  pkg: string,
  response: Response,
  file: string,
  dist: { integrity?: string; shasum?: string },
  maxBytes = MAX_NPM_TARBALL_BYTES,
): Promise<number> {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new UnprocessableError(
      'plugin_npm_tarball_too_large',
      `npm tarball for "${pkg}" exceeds the ${maxBytes}-byte download limit.`,
    )
  }
  const reader = response.body?.getReader()
  if (!reader) {
    throw new InvalidRequestError(
      'plugin_npm_fetch_failed',
      `npm tarball for "${pkg}" had no body.`,
    )
  }
  const check = npmIntegrityCheck(dist)
  const hash = check ? createHash(check.algorithm) : null
  const handle = await fs.open(file, 'wx')
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel().catch(() => {})
        throw new UnprocessableError(
          'plugin_npm_tarball_too_large',
          `npm tarball for "${pkg}" exceeds the ${maxBytes}-byte download limit.`,
        )
      }
      hash?.update(value)
      let offset = 0
      while (offset < value.byteLength) {
        const { bytesWritten } = await handle.write(value, offset, value.byteLength - offset, null)
        offset += bytesWritten
      }
    }
  } catch (error) {
    await handle.close().catch(() => {})
    await rmrf(file)
    throw error
  }
  await handle.close()
  try {
    if (check && hash) assertNpmIntegrity(pkg, check.expected, hash.digest(check.encoding))
  } catch (error) {
    await rmrf(file)
    throw error
  }
  return total
}
