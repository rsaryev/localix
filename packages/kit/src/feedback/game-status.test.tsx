import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { Button } from '../controls/button'
import { GameControlRow, GameProblem, GameStatus } from './game-status'

describe('game status', () => {
  test('the status keeps one height and truncates a long headline instead of wrapping', () => {
    const html = renderToStaticMarkup(
      <GameStatus
        title="The decision model is thinking about it"
        suffix="· 12s"
        detail="Score 2–1"
      />,
    )
    expect(html).toContain('h-11')
    expect(html).toContain('truncate')
    // The full headline stays reachable after truncation.
    expect(html).toContain('title="The decision model is thinking about it"')
    expect(html).toContain('· 12s')
  })

  test('the row keeps the controls beside the status, stacking only for a narrow pane', () => {
    const html = renderToStaticMarkup(
      <GameControlRow status={<GameStatus title="Your turn" />} controls={<Button>New</Button>} />,
    )
    expect(html).toContain('grid-cols-[minmax(0,1fr)_auto]')
    expect(html).toContain('@max-sm:grid-cols-1')
    expect(html).not.toContain('flex-wrap items-center justify-between')
  })

  test('a problem floats over the board with its reason and actions, and announces itself', () => {
    const html = renderToStaticMarkup(
      <GameProblem
        title="The agent did not move"
        description="This app cannot wake a chat."
        actions={<Button size="sm">Ask again</Button>}
      />,
    )
    expect(html).toContain('absolute inset-x-3 top-3')
    expect(html).toContain('role="alert"')
    expect(html).toContain('This app cannot wake a chat.')
    expect(html).toContain('Ask again')
  })

  test('a slow wait is a status, not an alert', () => {
    const html = renderToStaticMarkup(<GameProblem role="status" title="Taking a while" />)
    expect(html).toContain('role="status"')
    expect(html).not.toContain('role="alert"')
  })
})
