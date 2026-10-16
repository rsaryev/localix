import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createDocumentStore } from './store'
import { createDocumentsService, MAX_INPUT_BYTES } from './service'
import { DocumentError } from './errors'

/**
 * `MAX_INPUT_BYTES` exists to keep a huge document out of the API process's memory. It
 * used to be checked on the RESOLVED bytes — i.e. after the whole file had been read —
 * so "open as table" on a multi-gigabyte csv allocated all of it first and only then
 * refused. The guard sat downstream of the cost it exists to prevent.
 */
const tmpRoots: string[] = []
async function freshStoreDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'localix-oversize-test-'))
  tmpRoots.push(dir)
  return join(dir, 'documents')
}
afterAll(async () => {
  for (const dir of tmpRoots) await rm(dir, { recursive: true, force: true })
})

describe('oversized document input', () => {
  test('is refused WITHOUT reading the file', async () => {
    let readCalls = 0
    const service = createDocumentsService({
      store: createDocumentStore({ dir: await freshStoreDir() }),
      statPathSize: async () => MAX_INPUT_BYTES + 1,
      readPath: async () => {
        readCalls += 1
        return Buffer.alloc(0)
      },
    })

    const err = await service.extract({ path: '/w/huge.csv' }).catch((e: unknown) => e)
    expect((err as DocumentError).message).toMatch(/exceeds/)
    // The whole point: the bytes never entered the process.
    expect(readCalls).toBe(0)
  })

  test('reports too_large (413), not not_found (404)', async () => {
    const service = createDocumentsService({
      store: createDocumentStore({ dir: await freshStoreDir() }),
      statPathSize: async () => MAX_INPUT_BYTES + 1,
      readPath: async () => Buffer.alloc(0),
    })

    const err = await service.extract({ path: '/w/huge.csv' }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(DocumentError)
    expect((err as DocumentError).code).toBe('too_large')
  })

  test('a file at or under the cap is read as before', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'localix-oversize-ok-'))
    tmpRoots.push(dir)
    const path = join(dir, 'small.csv')
    await writeFile(path, 'a,b\n1,2\n', 'utf8')

    const service = createDocumentsService({
      store: createDocumentStore({ dir: await freshStoreDir() }),
    })
    const res = await service.extract({ path })
    expect(res.document.kind).toBe('table')
  })

  test('an unreadable path is still not_found — the size probe does not mask it', async () => {
    const service = createDocumentsService({
      store: createDocumentStore({ dir: await freshStoreDir() }),
    })
    const err = await service
      .extract({ path: '/w/definitely/missing.csv' })
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(DocumentError)
    expect((err as DocumentError).code).toBe('not_found')
  })

  test('a DocumentError raised by the reader keeps its own code', async () => {
    const service = createDocumentsService({
      store: createDocumentStore({ dir: await freshStoreDir() }),
      statPathSize: async () => 10,
      readPath: async () => {
        throw new DocumentError('too_large', 'reader refused it')
      },
    })
    const err = await service.extract({ path: '/w/x.csv' }).catch((e: unknown) => e)
    // Wrapping every reader failure as `not_found` reported a 404 for a file that is
    // right there, and hid whatever the reader actually determined.
    expect((err as DocumentError).code).toBe('too_large')
  })
})
