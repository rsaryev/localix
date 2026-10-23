import { describe, expect, test } from 'bun:test'

import { createDocumentsResourceProvider } from './resource-provider'
import type { DocumentStore } from './documents/store'
import type { RecentsIndex } from './recents'

const ID = `${'a'.repeat(64)}.json`

function provider(options: { empty?: boolean; found?: boolean } = {}) {
  const recents: RecentsIndex = {
    record: async () => {},
    list: async () =>
      options.empty
        ? []
        : [
            {
              id: ID,
              source: 'quarterly-report.pdf',
              format: 'pdf',
              title: 'Quarterly report',
              at: 1,
            },
          ],
  }
  const store: DocumentStore = {
    put: async () => ({ id: ID }),
    getByHash: async () => null,
    get: async () =>
      options.found === false
        ? null
        : {
            kind: 'text',
            markdown: '# Quarterly report\n\nRevenue increased.',
            metadata: { format: 'pdf', pageCount: 2 },
          },
  }
  return createDocumentsResourceProvider({ recents, store })
}

describe('documents resource provider', () => {
  test('recent documents are flat, linkable roots with stable localix://resource/doc/ identities', async () => {
    const resource = provider()
    expect(await resource.listChildren('user', null)).toEqual([
      {
        uri: `localix://resource/doc/${ID}`,
        label: 'Quarterly report',
        detail: 'PDF · quarterly-report.pdf',
        hasChildren: false,
        icon: 'doc',
      },
    ])
    expect(await resource.listChildren('user', `localix://resource/doc/${ID}`)).toEqual([])
  })

  test('an empty recent index yields a non-selectable provider-owned notice', async () => {
    expect(await provider({ empty: true }).listChildren('user', null)).toEqual([
      expect.objectContaining({
        uri: 'localix://resource/doc#notice',
        label: 'No documents yet',
        hasChildren: false,
        notice: true,
      }),
    ])
  })

  test('expands cached content and rejects an unknown document', async () => {
    expect(await provider().expand('user', `localix://resource/doc/${ID}`)).toMatchObject({
      ok: true,
      content: expect.stringContaining('Revenue increased.'),
      language: 'markdown',
    })
    expect(await provider({ found: false }).expand('user', `localix://resource/doc/${ID}`)).toEqual(
      {
        ok: false,
        error: `unknown document: localix://resource/doc/${ID}`,
      },
    )
  })
})
