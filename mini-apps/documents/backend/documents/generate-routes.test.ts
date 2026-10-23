import { describe, expect, test } from 'bun:test'
import { createDocumentsRoutes } from './routes'
import { createDocumentsService } from './service'
import { createDocumentStore } from './store'

function makeApp() {
  const saved: Array<{ len: number; mediaType: string }> = []
  const service = createDocumentsService({
    store: createDocumentStore({ dir: '/tmp/localix-genroute-unused' }),
  })
  const app = createDocumentsRoutes(service, {
    saveMedia: async (bytes, mediaType) => {
      saved.push({ len: bytes.byteLength, mediaType })
      return { id: 'deadbeef.docx', size: bytes.byteLength }
    },
  })
  const post = (body: unknown) =>
    app.request('/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  return { post, saved }
}

describe('POST /rpc/documents/generate', () => {
  test('generates a docx, persists the bytes, and returns id + derived filename', async () => {
    const { post, saved } = makeApp()
    const res = await post({ format: 'docx', content: '# Hello\n\nWorld' })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      mediaId: string
      filename: string
      mediaType: string
      size: number
    }
    expect(body.mediaId).toBe('deadbeef.docx')
    expect(body.filename).toBe('hello.docx')
    expect(body.mediaType).toContain('wordprocessingml.document')
    expect(body.size).toBeGreaterThan(500)
    expect(saved).toHaveLength(1)
    expect(saved[0].len).toBe(body.size)
  })

  test('generates an xlsx from a Markdown table', async () => {
    const { post } = makeApp()
    const res = await post({ format: 'xlsx', content: '| A | B |\n| - | - |\n| 1 | 2 |' })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { filename: string; mediaType: string }
    expect(body.filename).toBe('spreadsheet.xlsx')
    expect(body.mediaType).toContain('spreadsheetml.sheet')
  })

  test('maps a generation failure to a typed 400', async () => {
    const { post } = makeApp()
    const res = await post({ format: 'xlsx', content: 'no table here' })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { code: string }
    expect(body.code).toBe('generate_failed')
  })

  test('rejects an unknown format at the validation layer', async () => {
    const { post } = makeApp()
    const res = await post({ format: 'txt', content: 'x' })
    expect(res.status).toBe(400)
  })
})
