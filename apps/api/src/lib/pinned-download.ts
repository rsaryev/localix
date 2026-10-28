/**
 * Download one pinned file — a local model's weights, a mini app's archive: streamed to
 * `<dest>.part`, hashed while it streams, size-capped, resumable, and renamed into place only when
 * the sha256 matches. A file at `dest` is therefore always a complete, verified copy — an
 * interrupted or tampered download never looks installed.
 */
import { once } from 'node:events'
import { createWriteStream } from 'node:fs'
import { mkdir, rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'

/** What a pinned download needs: where, how big, and what it must hash to. */
export interface PinnedFile {
  /** What the messages call it. */
  name: string
  url: string
  bytes: number
  sha256: string
}

export interface DownloadProgress {
  file: string
  received: number
  total: number
}

export interface DownloadOptions {
  signal?: AbortSignal
  onProgress?(progress: DownloadProgress): void
  /**
   * Give up when no byte arrives for this long (connecting counts): a stalled connection would
   * otherwise never settle. Default one minute.
   */
  stallTimeoutMs?: number
  /** Test seam. */
  fetchImpl?: typeof fetch
  /** Test seam: schedule `fn` after `ms`; returns the cancel. */
  setTimer?: (fn: () => void, ms: number) => () => void
}

export type DownloadFailure = 'http' | 'size' | 'checksum' | 'aborted' | 'network' | 'timeout'

const DEFAULT_STALL_TIMEOUT_MS = 60_000

const realTimer = (fn: () => void, ms: number) => {
  const timer = setTimeout(fn, ms)
  return () => clearTimeout(timer)
}

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

  // One controller for the caller's signal and the stall watchdog; the watchdog restarts on
  // every chunk, so only a connection that goes quiet is cut.
  const controller = new AbortController()
  const abortFromCaller = () => controller.abort()
  if (options.signal?.aborted) controller.abort()
  else options.signal?.addEventListener('abort', abortFromCaller, { once: true })
  const setTimer = options.setTimer ?? realTimer
  const stallMs = options.stallTimeoutMs ?? DEFAULT_STALL_TIMEOUT_MS
  let stalled = false
  let cancelWatchdog = () => {}
  const watch = () => {
    cancelWatchdog()
    cancelWatchdog = setTimer(() => {
      stalled = true
      controller.abort()
    }, stallMs)
  }
  const interrupted = (message: string, code: DownloadFailure) =>
    stalled && !options.signal?.aborted
      ? new DownloadError(`${file.name}: no data for ${Math.round(stallMs / 1000)} s`, 'timeout')
      : options.signal?.aborted
        ? new DownloadError('Download cancelled', 'aborted')
        : new DownloadError(message, code)
  try {
    await transfer()
  } finally {
    cancelWatchdog()
    options.signal?.removeEventListener('abort', abortFromCaller)
  }

  async function transfer() {
    let response: Response
    watch()
    try {
      response = await fetchImpl(file.url, {
        signal: controller.signal,
        redirect: 'follow',
        ...(received > 0 ? { headers: { range: `bytes=${received}-` } } : {}),
      })
    } catch (err) {
      throw interrupted(
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
        watch()
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
      throw interrupted(
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
}
