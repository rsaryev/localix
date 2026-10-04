import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'

import { RosterRowView } from './RosterRowView'
import type { RosterRow } from '../model/types'

/**
 * A live delegation whose screen has stopped moving is the one piece of evidence an unconfirmed `idle`
 * cannot give: Claude Code's manifest yields no positive `working` state, so a busy agent and a
 * finished one settle on the same fallback. Symphony measures the same thing to decide a run has
 * stalled; this reports it and leaves the decision to whoever launched the agent.
 */
const MINUTE = 60_000

function row(over: Partial<RosterRow> = {}): RosterRow {
  return {
    key: 'claude-code:abc',
    provider: 'claude-code',
    nativeSessionId: 'abc',
    title: 'Refactor the auth module',
    updatedAt: Date.now() - 2 * MINUTE,
    sourcePath: '/home/.claude/abc.jsonl',
    state: 'idle',
    authority: 'screen-manifest',
    ...over,
  }
}

function render(over: Partial<RosterRow> = {}) {
  // The row navigates on click, so it needs a router even to render.
  return renderToStaticMarkup(
    <MemoryRouter>
      <RosterRowView row={row(over)} providerName="Claude Code" />
    </MemoryRouter>,
  )
}

describe('a row shows a still screen instead of when we last looked', () => {
  test('past the shared floor it reports the stillness, and says what it might mean', () => {
    const html = render({ terminalId: 't1', lastChangeAt: Date.now() - 12 * MINUTE })

    expect(html).toContain('12m still')
    expect(html).toContain('may have finished, or it may be stuck')
  })

  test('a screen that moved recently keeps the ordinary relative time', () => {
    const html = render({ terminalId: 't1', lastChangeAt: Date.now() - 30_000 })

    expect(html).not.toContain('still')
  })

  test('a historical row is never called still, having no screen', () => {
    // Three hours unchanged, and no terminal: stillness is not a fact about this row's agent.
    const html = render({ lastChangeAt: Date.now() - 180 * MINUTE })

    expect(html).not.toContain('still')
  })
})
