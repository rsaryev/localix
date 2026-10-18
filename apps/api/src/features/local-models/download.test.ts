import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DownloadError, downloadPinned } from './download'

const body = new TextEncoder().encode('pinned weights '.repeat(1000))
const sha = new Bun.CryptoHasher('sha256').update(body).digest('hex')
const ranges: string[] = []
const server = Bun.serve({
  port: 0,
  hostname: '127.0.0.1',
  fetch(req) {
    const { pathname } = new URL(req.url)
    if (pathname === '/missing') return new Response('no', { status: 404 })
    const range = req.headers.get('range')
    if (range) ranges.push(range)
    // Only `/ranged` honours a range; `/ok` behaves like a server that ignores it.
    const from = range && pathname === '/ranged' ? Number(/bytes=(\d+)-/.exec(range)![1]) : 0
    return from > 0 ? new Response(body.slice(from), { status: 206 }) : new Response(body)
  },
})
const url = (p: string) => `http://127.0.0.1:${server.port}${p}`
const dirs: string[] = []
const temp = async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'localix-dl-'))
  dirs.push(dir)
  return dir
}
afterAll(async () => {
  await server.stop(true)
  for (const d of dirs) await rm(d, { recursive: true, force: true })
})

describe('downloadPinned', () => {
  test('writes the file only after its checksum matches, and reports progress', async () => {
    const dest = path.join(await temp(), 'model.bin')
    const seen: number[] = []
    await downloadPinned(
      { name: 'model.bin', url: url('/ok'), bytes: body.length, sha256: sha },
      dest,
      {
        onProgress: (p) => seen.push(p.received),
      },
    )
    expect(new Uint8Array(await readFile(dest))).toEqual(body)
    expect(seen.at(-1)).toBe(body.length)
  })

  test('a wrong checksum leaves nothing behind', async () => {
    const dest = path.join(await temp(), 'model.bin')
    const run = downloadPinned(
      { name: 'model.bin', url: url('/ok'), bytes: body.length, sha256: '0'.repeat(64) },
      dest,
    )
    await expect(run).rejects.toMatchObject({ code: 'checksum' })
    expect(await stat(dest).catch(() => null)).toBeNull()
    expect(await stat(`${dest}.part`).catch(() => null)).toBeNull()
  })

  test('a body larger than pinned is refused while streaming', async () => {
    const dest = path.join(await temp(), 'model.bin')
    const run = downloadPinned(
      { name: 'model.bin', url: url('/ok'), bytes: 100, sha256: sha },
      dest,
    )
    await expect(run).rejects.toBeInstanceOf(DownloadError)
    await expect(run).rejects.toMatchObject({ code: 'size' })
  })

  test('an interrupted download resumes from its partial file and still verifies', async () => {
    const dest = path.join(await temp(), 'model.bin')
    await Bun.write(`${dest}.part`, body.slice(0, 4000))
    ranges.length = 0
    await downloadPinned(
      { name: 'model.bin', url: url('/ranged'), bytes: body.length, sha256: sha },
      dest,
    )
    expect(ranges).toEqual(['bytes=4000-'])
    expect(new Uint8Array(await readFile(dest))).toEqual(body)
  })

  test('a server that ignores the range sends it all, and the download starts over', async () => {
    const dest = path.join(await temp(), 'model.bin')
    await Bun.write(`${dest}.part`, body.slice(0, 4000))
    await downloadPinned(
      { name: 'model.bin', url: url('/ok'), bytes: body.length, sha256: sha },
      dest,
    )
    expect(new Uint8Array(await readFile(dest))).toEqual(body)
  })

  test('an HTTP error is a classified failure', async () => {
    const dest = path.join(await temp(), 'model.bin')
    await expect(
      downloadPinned({ name: 'model.bin', url: url('/missing'), bytes: 1, sha256: sha }, dest),
    ).rejects.toMatchObject({ code: 'http' })
  })
})
