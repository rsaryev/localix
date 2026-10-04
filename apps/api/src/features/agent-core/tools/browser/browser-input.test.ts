import { describe, expect, test } from 'bun:test'

import {
  liftTrailingScreenshot,
  prepareBrowserArguments,
  retiredInteractionMessage,
} from './browser-input'
import {
  buildPreviewCommand,
  browserInputSchema,
  inferAction,
  missingFieldMessage,
} from './browser-input'

describe('viewport contract', () => {
  test('preserves exact dimensions, target identity and fill reset', () => {
    const parsed = browserInputSchema.parse({
      action: 'viewport',
      preview_id: 'http://localhost:5173',
      viewport: { width: 375, height: 667 },
    })
    expect(buildPreviewCommand({ ...parsed, action: 'viewport' })).toEqual({
      action: 'viewport',
      previewId: 'http://localhost:5173',
      viewport: { width: 375, height: 667 },
    })
    expect(inferAction({ viewport: null })).toBe('viewport')
    expect(buildPreviewCommand({ action: 'viewport', viewport: null }).viewport).toBeNull()
    expect(missingFieldMessage({ action: 'viewport' })).toContain('requires dimensions')
  })

  test('rejects unsupported, out-of-range and silently ignored settings', () => {
    for (const input of [
      { action: 'viewport', width: 375, height: 667 },
      { action: 'viewport', viewport: { width: 0, height: 667 } },
      { action: 'viewport', viewport: { width: 375.5, height: 667 } },
      { action: 'viewport', viewport: { width: 375, height: 9000 } },
      { action: 'viewport', viewport: { width: 375, height: 667, touch: true } },
      { action: 'snapshot', viewport: { width: 375, height: 667 } },
      { action: 'viewport', background: true, viewport: null },
      { action: 'steps', steps: [{ action: 'snapshot', viewport: { width: 375, height: 667 } }] },
    ])
      expect(browserInputSchema.safeParse(input).success).toBe(false)
  })
})

describe('act, then look — a batch that ends in a screenshot', () => {
  test('a trailing screenshot step becomes the call’s own action, keeping the steps', () => {
    // Seen twice in one turn: the member batched `[{evaluate…},{screenshot}]`, the step
    // vocabulary has no screenshot, and the whole call was refused on a schema error — so it
    // went back to one round trip per action, which is what the batch exists to prevent.
    const lifted = liftTrailingScreenshot({
      action: 'steps',
      steps: [{ action: 'evaluate', expression: '1' }, { action: 'take_screenshot' }],
    }) as { action: string; steps: { action: string }[] }
    expect(lifted.action).toBe('take_screenshot')
    expect(lifted.steps.map((step) => step.action)).toEqual(['evaluate'])
  })

  test('a screenshot in the MIDDLE is left alone, because the batch cannot return it', () => {
    // Dropping it silently would be worse than the refusal it replaces: the model would get an
    // image of a page at a moment it did not choose.
    const raw = {
      action: 'steps',
      steps: [{ action: 'take_screenshot' }, { action: 'click', ref: 'e1' }],
    }
    expect(liftTrailingScreenshot(raw)).toBe(raw)
  })

  test('an ordinary batch is untouched, and so is a lone screenshot step', () => {
    // A batch of one is the flat call written the long way; lifting it would change which
    // action the result describes for no gain.
    const batch = { action: 'steps', steps: [{ action: 'click' }, { action: 'snapshot' }] }
    expect(liftTrailingScreenshot(batch)).toBe(batch)
    const only = { action: 'steps', steps: [{ action: 'take_screenshot' }] }
    expect(liftTrailingScreenshot(only)).toBe(only)
  })

  test('anything that is not a steps batch passes straight through', () => {
    for (const raw of [null, 'x', { action: 'snapshot' }, { action: 'steps' }]) {
      expect(liftTrailingScreenshot(raw)).toBe(raw)
    }
  })
})

describe('prepareBrowserArguments — the lifts reach the dispatch path', () => {
  test('a page URL used as preview_id becomes the origin the host matches on', () => {
    // Seen live: QA passed "http://localhost:60831/index.html"; hosts compare the preview id with
    // the origin exactly, none matched, and four commands timed out as host_unavailable.
    expect(
      prepareBrowserArguments({
        action: 'take_screenshot',
        preview_id: 'http://localhost:60831/index.html',
      }),
    ).toEqual({ action: 'take_screenshot', preview_id: 'http://localhost:60831' })
    const origin = { action: 'snapshot', preview_id: 'http://localhost:60831' }
    expect(prepareBrowserArguments(origin)).toBe(origin)
    const opaque = { action: 'snapshot', preview_id: 'preview-7' }
    expect(prepareBrowserArguments(opaque)).toBe(opaque)
    // `plugin:<name>` parses as a URL too — with an opaque origin, "null". It is a plugin view's
    // address, and rewriting it would send every command to no host.
    const pluginView = { action: 'snapshot', preview_id: 'plugin:focus-timer' }
    expect(prepareBrowserArguments(pluginView)).toBe(pluginView)
  })

  test('a retired flat interaction is refused with the steps call that replaces it', () => {
    // The flat contract left the schema; accepting it in execute kept a second contract alive.
    // The validator alone would answer "must be equal to one of the allowed values", so the
    // refusal is built from the model's own fields: the call it can send next.
    expect(() => prepareBrowserArguments({ action: 'click', ref: 'e3' })).toThrow(
      '{"action":"steps","steps":[{"action":"click","ref":"e3"}]}',
    )
    expect(retiredInteractionMessage({ action: 'press', keys: ['Tab'] })).toContain(
      'action="press" is a step, not a top-level action',
    )
    // No action, but step fields at top level: the flat form written without its verb.
    expect(retiredInteractionMessage({ ref: 'e3', text: 'Ada' })).toContain(
      '{"action":"steps","steps":[{"action":"type","ref":"e3","text":"Ada"}]}',
    )
    // The singular alias names the batch, not a flat interaction, so it is not refused here.
    expect(retiredInteractionMessage({ action: 'step', ref: 'e3' })).toBeUndefined()
    expect(() => prepareBrowserArguments({ action: 'hover', selector: '#a' })).toThrow(
      'Interactions go inside "steps"',
    )
  })

  test('the current shapes pass the refusal untouched', () => {
    for (const raw of [
      null,
      { action: 'steps', steps: [{ action: 'click', ref: 'e3' }] },
      { action: 'take_screenshot', ref: 'e3' },
      { ref: 'e3' },
      // Another action with a stray step field is an unknown field; the validator names it.
      { action: 'snapshot', text: 'x' },
    ])
      expect(retiredInteractionMessage(raw)).toBeUndefined()
  })

  test('the zod schema refuses the flat form too, so no parse path accepts it', () => {
    for (const raw of [
      { action: 'click', ref: 'e3' },
      { action: 'steps', steps: [{ action: 'click', ref: 'e3' }], text: 'x' },
      { action: 'snapshot', interactiveOnly: true },
    ])
      expect(browserInputSchema.safeParse(raw).success).toBe(false)
  })

  test('runs the batch lifts and the step alias together', () => {
    expect(
      prepareBrowserArguments({
        action: 'step',
        steps: [{ action: 'press', key: 'Tab' }, { action: 'take_screenshot' }],
      }),
    ).toEqual({ action: 'take_screenshot', steps: [{ action: 'press', key: 'Tab' }] })
  })
})
