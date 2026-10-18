/**
 * Download one pinned file: streamed to `<dest>.part`, hashed while it streams, size-capped,
 * resumable, and renamed into place only when the sha256 matches. A file at `dest` is therefore always a
 * complete, verified copy — an interrupted or tampered download never looks installed.
 */
import { once } from 'node:events'
import { createWriteStream } from 'node:fs'
import { mkdir, rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import type { LocalModelFile } from './contracts'

/** What a pinned download needs: where, how big, and what it must hash to. */
export type PinnedFile = Pick<LocalModelFile, 'name' | 'url' | 'bytes' | 'sha256'>

export interface DownloadProgress {
  file: string
  received: number
  total: number
}

export interface DownloadOptions {
  signal?: AbortSignal
  onProgress?(progress: DownloadProgress): void
  /** Test seam. */
  fetchImpl?: typeof fetch
}

export type DownloadFailure = 'http' | 'size' | 'checksum' | 'aborted' | 'network'

export class DownloadError extends Error {
  readonly code: DownloadFailure
  constructor(message: string, code: DownloadFailure) {
    super(message)
    this.name = 'DownloadError'
    this.code = code
  }
}

/** True when `dest` exists with the pinned size. (The hash was checked when it was written.) */
export async function isDownloaded(file: PinnedFile, dest: string): Promise<boolean> {
  const info = await stat(dest).catch(() => null)
  return !!info && info.isFile() && info.size === file.bytes
}

const PROGRESS_STEP_BYTES = 1 << 20

/** Bytes already in `.part` from an interrupted attempt, and their running hash. */
async function resumePoint(part: string, total: number) {
  const hash = new Bun.CryptoHasher('sha256')
  const size = (await stat(part).catch(() => null))?.size ?? 0
  if (size <= 0 || size >= total) {
    await rm(part, { force: true })
    return { hash, size: 0 }
  }
  for await (const chunk of Bun.file(part).stream() as unknown as AsyncIterable<Uint8Array>) {
    hash.update(chunk)
  }
  return { hash, size }
}

function openSink(part: string, append: boolean) {
  const stream = createWriteStream(part, { flags: append ? 'a' : 'w' })
  return {
    async write(chunk: Uint8Array) {
      if (!stream.write(chunk)) await once(stream, 'drain')
    },
    close: () =>
      new Promise<void>((resolve, reject) =>
        stream.end((err?: Error | null) => (err ? reject(err) : resolve())),
      ),
  }
}

/**
 * Download one pinned file, resuming an interrupted attempt: the bytes already in `.part` are
 * hashed again and the request asks for the rest (`Range`). A server that ignores the range sends
 * the whole file and the attempt starts over. Network failures and cancellation keep `.part` for
 * the next attempt; a size or checksum failure deletes it — those bytes are wrong, not short.
 */
export async function downloadPinned(
  file: PinnedFile,
  dest: string,
  options: DownloadOptions = {},
): Promise<void> {
  if (await isDownloaded(file, dest)) return
  await mkdir(path.dirname(dest), { recursive: true })
  const part = `${dest}.part`
  const fetchImpl = options.fetchImpl ?? fetch
  let { hash, size: received } = await resumePoint(part, file.bytes)

  let response: Response
  try {
    response = await fetchImpl(file.url, {
      signal: options.signal,
      redirect: 'follow',
      ...(received > 0 ? { headers: { range: `bytes=${received}-` } } : {}),
    })
  } catch (err) {
    if (options.signal?.aborted) throw new DownloadError('Download cancelled', 'aborted')
    throw new DownloadError(
      `Could not reach ${new URL(file.url).host}: ${err instanceof Error ? err.message : String(err)}`,
      'network',
    )
  }
  if (!response.ok || !response.body) {
    throw new DownloadError(`${file.name}: the server answered ${response.status}`, 'http')
  }
  const resumed = received > 0 && response.status === 206
  if (!resumed && received > 0) {
    hash = new Bun.CryptoHasher('sha256')
    received = 0
  }

  const sink = openSink(part, resumed)
  let reported = received
  options.onProgress?.({ file: file.name, received, total: file.bytes })
  try {
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      received += chunk.byteLength
      if (received > file.bytes) {
        throw new DownloadError(
          `${file.name} is larger than the pinned ${file.bytes} bytes`,
          'size',
        )
      }
      hash.update(chunk)
      await sink.write(chunk)
      if (received - reported >= PROGRESS_STEP_BYTES) {
        reported = received
        options.onProgress?.({ file: file.name, received, total: file.bytes })
      }
    }
    await sink.close()
  } catch (err) {
    await sink.close().catch(() => {})
    if (err instanceof DownloadError) {
      await rm(part, { force: true })
      throw err
    }
    if (options.signal?.aborted) throw new DownloadError('Download cancelled', 'aborted')
    throw new DownloadError(
      `${file.name} download failed: ${err instanceof Error ? err.message : String(err)}`,
      'network',
    )
  }

  if (received !== file.bytes) {
    // Short: the next attempt resumes from here. Long cannot happen past the check above.
    throw new DownloadError(`${file.name} ended at ${received} of ${file.bytes} bytes`, 'network')
  }
  const digest = hash.digest('hex')
  if (digest !== file.sha256) {
    await rm(part, { force: true })
    throw new DownloadError(`${file.name} failed its checksum (got ${digest})`, 'checksum')
  }
  options.onProgress?.({ file: file.name, received, total: file.bytes })
  await rename(part, dest)
}
