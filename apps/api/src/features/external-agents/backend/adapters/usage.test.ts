import { describe, expect, test } from 'bun:test'

import { normalizeTokenSample, SessionUsageAccumulator, usageDelta } from './usage'

describe('provider token normalization', () => {
  test('turns subset-style cache counters into additive components', () => {
    // Codex/Gemini input already includes cache reads. The normalized fields must add back to the
    // provider total or every aggregate and cache percentage will double-count cache hits.
    expect(
      normalizeTokenSample({
        inputTokens: 100,
        cachedInputTokens: 40,
        outputTokens: 10,
        totalTokens: 110,
        inputIncludesCached: true,
      }),
    ).toMatchObject({
      inputTokens: 60,
      cachedInputTokens: 40,
      outputTokens: 10,
      totalTokens: 110,
    })
  })

  test('uses cumulative deltas and ignores a repeated flat Codex total', () => {
    const first = normalizeTokenSample({
      inputTokens: 100,
      cachedInputTokens: 40,
      outputTokens: 10,
      totalTokens: 110,
      inputIncludesCached: true,
    })
    const second = normalizeTokenSample({
      inputTokens: 160,
      cachedInputTokens: 80,
      outputTokens: 16,
      totalTokens: 176,
      inputIncludesCached: true,
    })
    expect(usageDelta(second, first)).toMatchObject({
      inputTokens: 20,
      cachedInputTokens: 40,
      outputTokens: 6,
      totalTokens: 66,
      requests: 1,
    })
    expect(usageDelta(second, second).requests).toBe(0)
    expect(usageDelta(second, second).totalTokens).toBe(0)
  })

  test('folds separately reported thinking into output while retaining the subset', () => {
    expect(
      normalizeTokenSample({
        inputTokens: 20,
        outputTokens: 5,
        reasoningTokens: 2,
        totalTokens: 27,
        reasoningIncludedInOutput: false,
      }),
    ).toMatchObject({ outputTokens: 7, reasoningTokens: 2, totalTokens: 27 })
  })

  test('retains request-day and model attribution', () => {
    const usage = new SessionUsageAccumulator()
    usage.add(
      normalizeTokenSample({ inputTokens: 10, outputTokens: 2 }),
      'model-a',
      Date.parse('2026-08-01T23:59:00Z'),
    )
    usage.add(
      normalizeTokenSample({ inputTokens: 20, outputTokens: 3 }),
      'model-b',
      Date.parse('2026-08-02T00:01:00Z'),
    )

    const result = usage.result()
    expect(result?.totalTokens).toBe(35)
    expect(result?.requests).toBe(2)
    expect(result?.byDay.map((day) => day.day)).toEqual(['2026-08-01', '2026-08-02'])
    expect(result?.byModel.map((model) => model.model)).toEqual(['model-b', 'model-a'])
  })

  test("a provider's placeholder is counted but not named as a model", () => {
    // Claude Code writes `"model":"<synthetic>"` on messages it fabricates locally, with every
    // counter at zero. Across a long history it can rank high by session count in the model
    // distribution while contributing nothing, so the tile counted one model more than had been
    // used. The angle brackets are the rule, not the name: no model id contains them.
    const usage = new SessionUsageAccumulator()
    usage.add(normalizeTokenSample({ inputTokens: 10, outputTokens: 2 }), 'model-a')
    usage.add(normalizeTokenSample({ inputTokens: 5, outputTokens: 1 }), '<synthetic>')

    const result = usage.result()
    expect(result?.byModel.map((model) => model.model)).toEqual(['model-a'])
    // The sample still counts: dropping it rather than only its attribution would understate the
    // session, and a placeholder's tokens are as real as any other.
    expect(result?.totalTokens).toBe(18)
    expect(result?.requests).toBe(2)
  })
})

describe('reasoning is a SUBSET of output, and stays one', () => {
  /**
   * `TokenUsage.reasoningTokens` is documented as "subset of output where the provider reports it
   * separately", and `Math.min` is what makes that true of the value rather than only of the comment.
   * A mutation sweep found nothing testing it: removing the cap left every test in this plugin green.
   *
   * It is DEFENSIVE, and checked as such rather than assumed: Codex token rows seen so far never
   * report reasoning above output, nor zero output with non-zero reasoning. So the cap never fires
   * today — which is exactly why it would be deleted by a tidy-up with no signal, leaving a later
   * provider free to render "reasoning 500 of output 200".
   */
  test('a record claiming more reasoning than output is capped, not reported as given', () => {
    const usage = normalizeTokenSample({
      inputTokens: 100,
      outputTokens: 200,
      reasoningTokens: 500,
    })

    expect(usage.outputTokens).toBe(200)
    expect(usage.reasoningTokens).toBe(200)
  })

  test('reasoning survives intact when it fits inside output', () => {
    const usage = normalizeTokenSample({ inputTokens: 1, outputTokens: 200, reasoningTokens: 60 })

    expect(usage.reasoningTokens).toBe(60)
  })

  test('when the provider reports reasoning OUTSIDE output, the cap cannot bite', () => {
    // `reasoningIncludedInOutput: false` adds reasoning into output first, so the subset relation holds
    // by construction and the whole figure is preserved.
    const usage = normalizeTokenSample({
      inputTokens: 1,
      outputTokens: 200,
      reasoningTokens: 500,
      reasoningIncludedInOutput: false,
    })

    expect(usage.outputTokens).toBe(700)
    expect(usage.reasoningTokens).toBe(500)
  })
})
