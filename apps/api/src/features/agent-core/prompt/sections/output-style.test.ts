import { describe, expect, test } from 'bun:test'

import { RUNTIME_CONTEXT_MARKER } from '@localixai/agent/chat-cache'

import { buildAgentSystemPrompt, buildAgentSystemPromptParts } from '../assemble'
import { createRuntimeToolRegistry } from '../../tool-registry'

const VERIFY_LINE = 'Complete your part of the requested outcome and verify what you did'
const toolRegistry = createRuntimeToolRegistry()
const style = (keepCodingInstructions: boolean) => ({
  name: 'my-plugin:terse',
  prompt: 'Keep every reply short. Skip preambles and summaries.',
  keepCodingInstructions,
})

describe('# Output style', () => {
  test('renders the chosen style in the cached prefix, after the answer formatting', () => {
    const { stablePrompt, runtimeSections } = buildAgentSystemPromptParts({
      toolRegistry,
      outputStyle: style(true),
    })
    expect(stablePrompt).toContain('# Output style')
    expect(stablePrompt).toContain('"my-plugin:terse" output style')
    expect(stablePrompt).toContain('Keep every reply short.')
    expect(stablePrompt.indexOf('# Output style')).toBeGreaterThan(
      stablePrompt.indexOf('# Answer formatting'),
    )
    expect(runtimeSections.map((section) => section.text).join('\n')).not.toContain(
      '# Output style',
    )
    const whole = buildAgentSystemPrompt({ toolRegistry, outputStyle: style(true) })
    expect(whole.indexOf('# Output style')).toBeLessThan(
      whole.indexOf(RUNTIME_CONTEXT_MARKER) === -1
        ? Infinity
        : whole.indexOf(RUNTIME_CONTEXT_MARKER),
    )
  })

  test('without a style nothing renders, and the coding instructions stay', () => {
    const prompt = buildAgentSystemPrompt({ toolRegistry })
    expect(prompt).not.toContain('# Output style')
    expect(prompt).toContain(VERIFY_LINE)
  })

  test('keep-coding-instructions decides whether the engineering lines stay', () => {
    expect(buildAgentSystemPrompt({ toolRegistry, outputStyle: style(true) })).toContain(
      VERIFY_LINE,
    )
    const without = buildAgentSystemPrompt({ toolRegistry, outputStyle: style(false) })
    expect(without).not.toContain(VERIFY_LINE)
    // The tool routing is how the run's tools are used at all, so it stays.
    expect(without).toContain('# Execution discipline')
  })
})
