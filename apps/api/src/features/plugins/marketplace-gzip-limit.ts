import { createReadStream } from 'node:fs'
import { createGunzip } from 'node:zlib'

import { UnprocessableError } from '../../lib/domain-errors'
import { errorMessage } from '../../lib/errors'
import { ZIP_LIMITS } from './marketplace-zip-scan'

/**
 * Refuse a gzipped tarball that unpacks past `maxBytes` before `tar` writes any of it: the
 * download cap bounds the compressed bytes only, and a small gzip can expand to fill the disk.
 * The stream is inflated and counted, never stored.
 */
export async function assertGunzipWithin(
  file: string,
  what: string,
  maxBytes: number = ZIP_LIMITS.maxTotalBytes,
): Promise<void> {
  const source = createReadStream(file)
  const stream = source.pipe(createGunzip())
  source.on('error', (err) => stream.destroy(err))
  let total = 0
  try {
    for await (const chunk of stream as AsyncIterable<Buffer>) {
      total += chunk.byteLength
      if (total > maxBytes) break
    }
  } catch (err) {
    throw new UnprocessableError(
      'plugin_npm_extract_failed',
      `Extracting ${what} failed: not a valid gzip (${errorMessage(err)})`,
    )
  } finally {
    stream.destroy()
    source.destroy()
  }
  if (total > maxBytes)
    throw new UnprocessableError(
      'plugin_npm_tarball_too_large',
      `${what} unpacks to more than ${maxBytes} bytes.`,
    )
}
