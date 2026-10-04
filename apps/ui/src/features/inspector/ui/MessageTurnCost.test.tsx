import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { MessageTurnCost } from './MessageTurnCost'

/**
 * Per-turn accounting was streamed with every assistant message and rendered nowhere: usage
 * only appeared as a SESSION aggregate, and `providerMeta` was converted into the UI model and
 * dropped. The session total says everything is fine on average, which is exactly what hides
 * a turn whose prefix cache stopped hitting.
 */
describe('what one turn cost', () => {
  test('names the model that served THIS turn, not the session pick', () => {
    // A session can switch models mid-way, so the turn's own attribution is the only answer.
    const html = renderToStaticMarkup(
      <MessageTurnCost
        provider={{ providerId: 'anthropic', providerName: 'Anthropic', modelId: 'claude-x' }}
      />,
    )
    expect(html).toContain('Anthropic')
    expect(html).toContain('claude-x')
  })

  test('reports cache reads and writes separately', () => {
    // The reason this section exists: cached input is a working prefix cache seen from
    // outside, and a cache WRITE on a turn that should have hit is a busted one. A sum hides
    // both.
    const html = renderToStaticMarkup(
      <MessageTurnCost
        usage={{
          inputTokens: 12_000,
          outputTokens: 300,
          cachedInputTokens: 11_500,
          cacheWriteTokens: 400,
          cacheWrite1hTokens: 100,
        }}
      />,
    )
    expect(html).toContain('Cache read')
    expect(html).toContain('11,500')
    expect(html).toContain('Cache write')
    expect(html).toContain('1h')
  })

  test('a provider that reported no cache activity is not the same as one that never reported', () => {
    const silent = renderToStaticMarkup(
      <MessageTurnCost usage={{ inputTokens: 10, outputTokens: 2 }} />,
    )
    expect(silent).not.toContain('Cache read')

    const zero = renderToStaticMarkup(
      <MessageTurnCost usage={{ inputTokens: 10, outputTokens: 2, cachedInputTokens: 0 }} />,
    )
    expect(zero).toContain('Cache read')
  })

  test('cost carries its source, because an estimate is a different claim', () => {
    const html = renderToStaticMarkup(
      <MessageTurnCost
        usage={{ inputTokens: 1, outputTokens: 1, totalCost: 0.0125, costSource: 'estimated' }}
      />,
    )
    expect(html).toContain('$0.0125')
    expect(html).toContain('estimated')
  })

  test('nothing recorded renders nothing at all', () => {
    expect(renderToStaticMarkup(<MessageTurnCost />)).toBe('')
  })
})
