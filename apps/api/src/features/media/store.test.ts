import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createMediaStore, isMediaId, mediaTypeForName } from './store'
import { createMediaRoutes } from './routes'

const tmpRoots: string[] = []
async function freshStoreDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'localix-media-test-'))
  tmpRoots.push(dir)
  return join(dir, 'media')
}

afterAll(async () => {
  for (const dir of tmpRoots) await rm(dir, { recursive: true, force: true })
})

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

describe('media store', () => {
  test('putBase64 → getBase64 round-trips the exact bytes', async () => {
    const store = createMediaStore({ dir: await freshStoreDir() })
    const { id, size } = await store.putBase64(PNG_BASE64, 'image/png')
    expect(isMediaId(id)).toBe(true)
    expect(id.endsWith('.png')).toBe(true)
    expect(size).toBe(Buffer.from(PNG_BASE64, 'base64').length)
    expect(await store.getBase64(id)).toBe(PNG_BASE64)
  })

  test('repairs same-size corruption in a content-addressed file', async () => {
    const store = createMediaStore({ dir: await freshStoreDir() })
    const meta = await store.putBase64(PNG_BASE64, 'image/png')
    const resolved = await store.resolve(meta.id)
    expect(resolved).not.toBeNull()
    await writeFile(resolved!.filePath, Buffer.alloc(meta.size, 0))

    await store.putBase64(PNG_BASE64, 'image/png')

    expect(await store.getBase64(meta.id)).toBe(PNG_BASE64)
  })

  test('content-addressed: identical bytes de-dupe to the same id', async () => {
    const store = createMediaStore({ dir: await freshStoreDir() })
    const a = await store.putBase64(PNG_BASE64, 'image/png')
    const b = await store.putBase64(PNG_BASE64, 'image/png')
    expect(a.id).toBe(b.id)
  })

  test('extension follows the media type', async () => {
    const store = createMediaStore({ dir: await freshStoreDir() })
    const mp4 = await store.putBase64(PNG_BASE64, 'video/mp4')
    expect(mp4.id.endsWith('.mp4')).toBe(true)
    const webp = await store.putBase64(PNG_BASE64, 'image/webp')
    expect(webp.id.endsWith('.webp')).toBe(true)
  })

  test('office document media types map to a short, valid content id', async () => {
    const store = createMediaStore({ dir: await freshStoreDir() })
    const docxType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    const { id } = await store.putBase64(PNG_BASE64, docxType)
    // The long OOXML subtype must collapse to `.docx` so the id stays valid (≤8-char ext).
    expect(isMediaId(id)).toBe(true)
    expect(id.endsWith('.docx')).toBe(true)
    const resolved = await store.resolve(id)
    expect(resolved?.mediaType).toBe(docxType)
    expect(await store.getBase64(id)).toBe(PNG_BASE64)
  })

  test('resolve returns path + content-type derived from the id extension', async () => {
    const store = createMediaStore({ dir: await freshStoreDir() })
    const { id } = await store.putBase64(PNG_BASE64, 'image/png')
    const resolved = await store.resolve(id)
    expect(resolved?.mediaType).toBe('image/png')
    expect(resolved?.size).toBeGreaterThan(0)
  })

  test('the original filename extension wins, format-agnostically', async () => {
    // A dropped file with an unknown extension + a generic browser type must keep
    // ITS extension as the id's — no per-format map entry required downstream.
    const store = createMediaStore({ dir: await freshStoreDir() })
    const { id } = await store.putBytes(
      new TextEncoder().encode('log line'),
      'application/octet-stream',
      { nameHint: 'gindex.log' },
    )
    expect(isMediaId(id)).toBe(true)
    expect(id.endsWith('.log')).toBe(true)
    expect(await store.getBase64(id)).not.toBeNull()
  })

  test('an over-budget MIME subtype clamps instead of minting an unreadable id', async () => {
    // REGRESSION: `application/octet-stream` used to yield an 11-char extension the
    // store's own isMediaId rejected — the upload "succeeded" but every read 404'd.
    const store = createMediaStore({ dir: await freshStoreDir() })
    const { id } = await store.putBytes(
      new TextEncoder().encode('opaque'),
      'application/octet-stream',
    )
    expect(isMediaId(id)).toBe(true)
    expect(id.endsWith('.bin')).toBe(true)
    expect(await store.getBase64(id)).not.toBeNull()
  })

  test('rejects malformed / traversal ids', async () => {
    const store = createMediaStore({ dir: await freshStoreDir() })
    expect(isMediaId('../../etc/passwd')).toBe(false)
    expect(isMediaId('abc.png')).toBe(false) // not a 64-hex hash
    expect(await store.getBase64('../../etc/passwd')).toBeNull()
    expect(await store.resolve('../../etc/passwd')).toBeNull()
  })

  test('getBase64 / resolve return null for a missing id', async () => {
    const store = createMediaStore({ dir: await freshStoreDir() })
    const fakeId = `${'a'.repeat(64)}.png`
    expect(await store.getBase64(fakeId)).toBeNull()
    expect(await store.resolve(fakeId)).toBeNull()
  })

  test('putBytes stores raw bytes with the media-type extension', async () => {
    const store = createMediaStore({ dir: await freshStoreDir() })
    const bytes = new TextEncoder().encode('a,b\n1,2\n')
    const { id, size } = await store.putBytes(bytes, 'text/csv')
    expect(isMediaId(id)).toBe(true)
    expect(id.endsWith('.csv')).toBe(true)
    expect(size).toBe(bytes.byteLength)
    const resolved = await store.resolve(id)
    expect(resolved?.mediaType).toBe('text/csv')
  })
})

describe('mediaTypeForName', () => {
  test('maps known viewer/media extensions (authoritative over a blank browser type)', () => {
    expect(mediaTypeForName('report.pdf')).toBe('application/pdf')
    expect(mediaTypeForName('book.epub')).toBe('application/epub+zip')
    expect(mediaTypeForName('book.mobi')).toBe('application/x-mobipocket-ebook')
    expect(mediaTypeForName('book.azw3')).toBe('application/x-mobipocket-ebook')
    expect(mediaTypeForName('story.fb2')).toBe('application/x-fictionbook+xml')
    expect(mediaTypeForName('DATA.CSV')).toBe('text/csv')
    expect(mediaTypeForName('notes.docx')).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    )
    expect(mediaTypeForName('clip.mp4')).toBe('video/mp4')
  })
  test('unknown / extensionless names → undefined (caller falls back to the header)', () => {
    expect(mediaTypeForName('Makefile')).toBeUndefined()
    expect(mediaTypeForName('mystery.xyz')).toBeUndefined()
  })
})

describe('media route', () => {
  test('GET /:id streams the stored file with content-type + immutable cache', async () => {
    const store = createMediaStore({ dir: await freshStoreDir() })
    const { id, size } = await store.putBase64(PNG_BASE64, 'image/png')
    const app = createMediaRoutes(store)

    const res = await app.request(`/${id}`)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('image/png')
    expect(res.headers.get('Cache-Control')).toContain('immutable')
    const bytes = new Uint8Array(await res.arrayBuffer())
    expect(bytes.length).toBe(size)
    expect(Buffer.from(bytes).toString('base64')).toBe(PNG_BASE64)
  })

  test('GET /:id → 404 for an unknown id', async () => {
    const store = createMediaStore({ dir: await freshStoreDir() })
    const app = createMediaRoutes(store)
    const res = await app.request(`/${'b'.repeat(64)}.png`)
    expect(res.status).toBe(404)
  })

  test('POST / stores an upload and the returned id round-trips through GET', async () => {
    const store = createMediaStore({ dir: await freshStoreDir() })
    const app = createMediaRoutes(store)
    const body = new TextEncoder().encode('a,b\n1,2\n')

    const post = await app.request('/?name=data.csv', {
      method: 'POST',
      // Blank/wrong header on purpose — the filename extension must win.
      headers: { 'Content-Type': 'application/octet-stream' },
      body,
    })
    expect(post.status).toBe(200)
    const { id, name, mediaType, size } = (await post.json()) as {
      id: string
      name: string
      mediaType: string
      size: number
    }
    expect(name).toBe('data.csv')
    expect(mediaType).toBe('text/csv') // filename-derived, not the octet-stream header
    expect(id.endsWith('.csv')).toBe(true)
    expect(size).toBe(body.byteLength)

    const get = await app.request(`/${id}`)
    expect(get.status).toBe(200)
    expect(get.headers.get('Content-Type')).toBe('text/csv')
  })

  test('POST / accepts a zero-byte upload (empty files open, not 400)', async () => {
    const store = createMediaStore({ dir: await freshStoreDir() })
    const app = createMediaRoutes(store)
    // A zero-byte file is legitimate (a fresh .log, a touch'd placeholder) — it
    // must upload and read back so the viewer can open it as empty text.
    const res = await app.request('/?name=empty.csv', { method: 'POST', body: new Uint8Array(0) })
    expect(res.status).toBe(200)
    const { id } = (await res.json()) as { id: string }
    expect(await store.getBase64(id)).toBe('')
  })
})
