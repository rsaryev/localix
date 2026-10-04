import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { AgentStateGlyph } from './AgentStateGlyph'
import { AGENT_STATES } from '../model/types'

/**
 * The vocabulary, pinned.
 *
 * Five states rendered as five dots differing only by hue is a legend nobody reads. The two that
 * matter get their own FORM — motion for the one state that is ongoing, a check for the one that
 * is an outcome — and this test exists so a later tidy-up cannot quietly collapse them back into
 * coloured dots.
 */
describe('agent state glyph', () => {
  test('working is the only state rendered with motion', () => {
    // The app's own activity signal, not a bespoke spinner — same orb the chat shows while a turn
    // is running, so "something is happening" reads identically wherever it appears.
    const MOTION = 'lx-activity-orb'
    expect(renderToStaticMarkup(<AgentStateGlyph state="working" />)).toContain(MOTION)
    for (const state of AGENT_STATES.filter((s) => s !== 'working')) {
      expect(renderToStaticMarkup(<AgentStateGlyph state={state} />)).not.toContain(MOTION)
    }
  })

  test('done is an outcome, not another coloured dot', () => {
    // A settled state is a dot (a rounded span); `done` is a check, so it must be an icon.
    expect(renderToStaticMarkup(<AgentStateGlyph state="done" />)).toContain('<svg')
    expect(renderToStaticMarkup(<AgentStateGlyph state="idle" />)).not.toContain('<svg')
    expect(renderToStaticMarkup(<AgentStateGlyph state="blocked" />)).not.toContain('<svg')
  })

  test('every state is named for a screen reader', () => {
    for (const state of AGENT_STATES) {
      expect(renderToStaticMarkup(<AgentStateGlyph state={state} />)).toContain('aria-label')
    }
  })
})
