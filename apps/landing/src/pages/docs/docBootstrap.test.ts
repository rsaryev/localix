import { expect, test } from 'bun:test'
import { readDocBootstrap } from './docBootstrap'

function fixture(text: string, html = '<h1>Page</h1>'): Document {
  return {
    getElementById: (id: string) =>
      id === 'doc-bootstrap'
        ? { textContent: text }
        : id === 'doc-body'
          ? { innerHTML: html }
          : null,
  } as unknown as Document
}

test('retains built content only for the requested documentation route', () => {
  const data = { slug: 'guide', content: '# Page', headings: [] }
  expect(readDocBootstrap(fixture(JSON.stringify(data)), '/docs/guide')).toEqual({
    ...data,
    html: '<h1>Page</h1>',
  })
  expect(readDocBootstrap(fixture(JSON.stringify(data)), '/docs/other')).toBeUndefined()
})

test('broken bootstrap data falls back to the normal document loader', () => {
  for (const text of [
    'broken',
    '{}',
    '{"slug":"guide","content":false,"headings":[]}',
    '{"slug":"guide","content":"x","headings":[null]}',
  ]) {
    expect(readDocBootstrap(fixture(text), '/docs/guide')).toBeUndefined()
  }
})
