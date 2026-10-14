import { readLandingStyles } from '../../../scripts/read-styles'
import { afterAll, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'

let teardown: () => Promise<void>

beforeAll(() => {
  teardown = registerDom()
})
afterAll(async () => {
  await teardown()
})
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

test('wide documentation tables preserve semantic columns inside a bounded scroll owner', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { makeMdComponents } = await import('./markdownComponents')
  const Table = makeMdComponents('docs/getting-started/what-is-localix.md', () => {}).table
  const host = document.createElement('div')
  const root = createRoot(host)
  const headings = [
    'Feature name',
    'Configuration and prerequisites',
    'Description of behavior',
    'Reference',
  ]
  try {
    await act(async () =>
      root.render(
        <Table>
          <thead>
            <tr>
              {headings.map((title) => (
                <th key={title}>{title}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              {headings.map((title) => (
                <td key={title}>
                  A detailed description that should wrap within a readable column rather than
                  squeeze into the viewport.
                </td>
              ))}
            </tr>
          </tbody>
        </Table>,
      ),
    )
    expect(host.querySelector('.docs-table-scroll > table')).not.toBeNull()
    expect(host.querySelectorAll('th')).toHaveLength(4)
    expect(host.querySelectorAll('td')).toHaveLength(4)
    const css = readLandingStyles()
    const rule = (selector: string) => css.slice(css.indexOf(selector + ' {')).split('}')[0]
    expect(rule('.docs-table-scroll')).toContain('max-width: 100%')
    expect(rule('.docs-table-scroll')).toContain('overflow-x: auto')
    expect(rule('.docs-prose table')).toContain('width: max-content')
    expect(rule('.docs-prose td')).toContain('max-width: 40ch')
    expect(rule('.docs-prose td')).toContain('overflow-wrap: normal')
    expect(rule('.docs-prose td')).not.toContain('white-space: nowrap')
  } finally {
    await act(async () => root.unmount())
  }
})
