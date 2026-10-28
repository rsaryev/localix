import { describe, expect, test } from 'bun:test'
import { CALLOUT_KINDS, DIAGRAM_FENCE_LANGUAGE, DIAGRAM_KINDS } from '../../answer-markdown'
import {
  ANSWER_FORMAT_HEADER,
  ANSWER_FORMS_PRINCIPLE,
  buildAnswerFormatSection,
  rendersAnswerMarkdown,
} from './answer-format'
import { buildAgentSystemPrompt } from '../assemble'
import { resolveRunProfile } from '../../run-shape'

describe('# Answer formatting', () => {
  test('names every construct the renderer draws, read from the shared leaf', () => {
    const section = buildAnswerFormatSection()
    for (const kind of CALLOUT_KINDS) expect(section).toContain(`[!${kind.toUpperCase()}]`)
    expect(section).toContain(`\`\`\`${DIAGRAM_FENCE_LANGUAGE} fence`)
    for (const kind of DIAGRAM_KINDS) expect(section).toContain(kind)
  })

  test('respects style instructions supplied in the conversation', () => {
    expect(buildAgentSystemPrompt({})).toContain(ANSWER_FORMAT_HEADER)
    expect(buildAnswerFormatSection()).toContain('style preferences override')
  })

  test('encourages useful visuals with truthful data and discoverable controls', () => {
    const section = buildAnswerFormatSection()
    expect(section).toContain('proactively')
    expect(section).toContain('over ASCII art')
    expect(section).toContain('label illustrative data')
    expect(section).toContain('unsupported chart type')
    expect(section).toContain('enabled plugin destinations')
  })

  test('only where the transcript renderer is what the reader sees', () => {
    expect(rendersAnswerMarkdown('chat', undefined)).toBe(true)
    expect(rendersAnswerMarkdown('chat', 'telegram')).toBe(false)
    expect(rendersAnswerMarkdown('subagent', undefined)).toBe(false)
    expect(rendersAnswerMarkdown('automation', undefined)).toBe(false)

    // The principle that points at the forms rides inside the section: "use the forms" where
    // nothing renders them would make every relayed reply print raw markers.
    expect(buildAnswerFormatSection()).toContain(ANSWER_FORMS_PRINCIPLE)
    const channel = buildAgentSystemPrompt({ deliveryContext: { channel: 'telegram' } })
    expect(channel).not.toContain(ANSWER_FORMAT_HEADER)
    expect(channel).not.toContain(ANSWER_FORMS_PRINCIPLE)
    for (const sessionKind of ['subagent', 'job'] as const) {
      const agentProfile = resolveRunProfile({ sessionKind })
      expect(buildAgentSystemPrompt({ agentProfile })).not.toContain(ANSWER_FORMAT_HEADER)
    }
  })
})
