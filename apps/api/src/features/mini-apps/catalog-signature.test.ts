import { describe, expect, test } from 'bun:test'
import { generateKeyPairSync } from 'node:crypto'

import {
  catalogSignatureState,
  readCatalogSignature,
  signCatalog,
  verifyCatalogSignature,
} from './catalog-signature'

const author = generateKeyPairSync('ed25519')
const stranger = generateKeyPairSync('ed25519')
const catalog = new TextEncoder().encode('{"schema":1,"apps":[]}')

describe('a catalog signature', () => {
  test('signed with the key it names, it is signed by that key', () => {
    const signature = signCatalog(catalog, author.privateKey)
    const read = verifyCatalogSignature(catalog, signature)
    expect(read.state).toBe('signed')
    expect(read.state === 'signed' && read.key).toBe(JSON.parse(signature).key)
  })

  test('a catalog changed after it was signed is not', () => {
    const signature = signCatalog(catalog, author.privateKey)
    const changed = new TextEncoder().encode('{"schema":1,"apps":[{"name":"evil"}]}')
    expect(verifyCatalogSignature(changed, signature).state).toBe('invalid')
  })

  test('a signature that names another key than the one that made it is not', () => {
    const forged = {
      ...JSON.parse(signCatalog(catalog, stranger.privateKey)),
      key: JSON.parse(signCatalog(catalog, author.privateKey)).key,
    }
    expect(verifyCatalogSignature(catalog, JSON.stringify(forged)).state).toBe('invalid')
  })

  // The authoring plugin (localix-marketplace, `mini-app sign`) writes this same file for these
  // bytes and this key: the two sides agree on the format byte for byte.
  test('the signature the authoring plugin writes holds', () => {
    const bytes = new TextEncoder().encode('{"schema":1,"apps":[]}\n')
    const written =
      '{"schema":1,"algorithm":"ed25519","key":"6kpsY+KcUgq+9VB7Ey7F+ZVHdq6+vnuSQh7qaRRG0iw=","signature":"x14FDCLQa1mrXW5bu06kNoAMfVlMD4FY7cxCYobmglHedXe/6dx+Um81YVbHoaTUubDDcjLl9iBnw7rJTjYTDw=="}\n'
    expect(verifyCatalogSignature(bytes, written)).toEqual({
      state: 'signed',
      key: '6kpsY+KcUgq+9VB7Ey7F+ZVHdq6+vnuSQh7qaRRG0iw=',
    })
  })

  test('a file that is not a signature is not', () => {
    expect(verifyCatalogSignature(catalog, 'not json').state).toBe('invalid')
    expect(verifyCatalogSignature(catalog, '{"schema":1}').state).toBe('invalid')
  })
})

describe('reading the signature beside a catalog', () => {
  const served = (files: Record<string, Response | Error>) => {
    const asked: string[] = []
    const fetchImpl = (async (url: string | URL) => {
      asked.push(String(url))
      const answer = files[String(url)]
      if (answer instanceof Error) throw answer
      return answer ?? new Response('missing', { status: 404 })
    }) as unknown as typeof fetch
    return { fetchImpl, asked }
  }

  // The built-in catalog is served from releases/latest/…, which redirects to one release: its
  // signature is the one beside the file that was read, not whatever "latest" is a moment later.
  test('is read beside the catalog the address led to', async () => {
    const at = 'https://cdn.test/v1.2.0/mini-app-catalog.json'
    const { fetchImpl, asked } = served({
      [`${at}.sig`]: new Response(signCatalog(catalog, author.privateKey)),
    })
    const read = await readCatalogSignature(at, catalog, { fetchImpl })
    expect(read.state).toBe('signed')
    expect(asked).toEqual([`${at}.sig`])
  })

  test('none published means the catalog is not signed', async () => {
    const { fetchImpl } = served({})
    const read = await readCatalogSignature('https://cdn.test/c.json', catalog, { fetchImpl })
    expect(read.state).toBe('unsigned')
  })

  // A failed read says nothing about the signature: it must not look like one taken away.
  test('one that cannot be read is a failed read, not an unsigned catalog', async () => {
    const down = served({ 'https://cdn.test/c.json.sig': new Response('busy', { status: 503 }) })
    await expect(
      readCatalogSignature('https://cdn.test/c.json', catalog, { fetchImpl: down.fetchImpl }),
    ).rejects.toThrow('503')
    const offline = served({ 'https://cdn.test/c.json.sig': new Error('offline') })
    await expect(
      readCatalogSignature('https://cdn.test/c.json', catalog, { fetchImpl: offline.fetchImpl }),
    ).rejects.toThrow('offline')
  })
})

describe('what a signature means for a catalog', () => {
  const signed = { state: 'signed', key: 'K' } as const

  test('signed by the key kept for it', () => {
    expect(catalogSignatureState(signed, 'K')).toBe('signed')
  })

  test('signed by another key than the one kept for it', () => {
    expect(catalogSignatureState(signed, 'OTHER')).toBe('mismatch')
  })

  test('its signature taken away after a key was kept for it', () => {
    expect(catalogSignatureState({ state: 'unsigned' }, 'K')).toBe('mismatch')
  })

  test('a signature that does not hold for a catalog a key is kept for', () => {
    expect(catalogSignatureState({ state: 'invalid', reason: 'x' }, 'K')).toBe('mismatch')
  })

  test('a signature that does not hold, with no key kept, proves nothing either way', () => {
    expect(catalogSignatureState({ state: 'invalid', reason: 'x' }, undefined)).toBe('unsigned')
  })

  test('never signed, and no key kept', () => {
    expect(catalogSignatureState({ state: 'unsigned' }, undefined)).toBe('unsigned')
  })

  // Without a kept key a signature proves only that someone signed it: whoever could replace the
  // catalog could replace the signature too.
  test('signed, with no key kept for it, is not yet signed', () => {
    expect(catalogSignatureState(signed, undefined)).toBe('unsigned')
  })
})
