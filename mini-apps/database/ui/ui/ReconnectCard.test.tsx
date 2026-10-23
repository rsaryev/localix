import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { DbConnectionInfo } from '../dbClient'
import { ReconnectCard } from './ReconnectCard'

const connection: DbConnectionInfo = {
  id: 'c1',
  name: 'Production',
  dialect: 'postgres',
  connected: false,
  readonly: false,
  createdAt: 1,
}

describe('ReconnectCard', () => {
  test('is the host pane state — centred StateNotice, not a card pinned to the top', () => {
    // It was hand-built (`p-3 text-center`) beside a StateNotice for the sibling state, so the
    // same explorer drew "no connection" and "reconnecting" two different ways.
    const html = renderToStaticMarkup(<ReconnectCard connection={connection} problem={null} />)
    expect(html).toContain('justify-center')
    expect(html).toContain('role="status"')
    expect(html).toContain('Connecting')
    expect(html).toContain('Production')
    expect(html).not.toContain('p-3 text-center')
  })
})
