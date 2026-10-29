import { describe, expect, test } from 'bun:test'

import { buildAgentDirectorySection, buildTurnControlSection } from './conversation'
import {
  BOARD_OWNER,
  HUMAN_ASK_CONTROL,
  HUMAN_BOARD_CONTROL,
  HUMAN_NO_ASK_CONTROL,
} from './turn-contract'

describe('the turn contract', () => {
  test('the person is reached through ask, never a mention', () => {
    const section = buildTurnControlSection({ hasBoard: true, canAsk: true })
    expect(section).toContain(HUMAN_ASK_CONTROL)
    expect(section).toContain('Never @mention the person')
    expect(section).not.toContain(HUMAN_NO_ASK_CONTROL)
    expect(section).toContain(HUMAN_BOARD_CONTROL)
    expect(section).toContain('A card assigned to the person waits for them')
    expect(section).not.toContain('@human')
  })

  test('a run without ask proceeds on a stated assumption and never names the tool', () => {
    const section = buildTurnControlSection({})
    expect(section).toContain('proceed on your best assumption and state it')
    expect(section).not.toContain('ask tool')
  })

  test('names a task board only for a run that holds one', () => {
    // A board is a plugin tool; a contract naming it for a run without it once made a model
    // invent a board file.
    const without = buildTurnControlSection({})
    expect(without).not.toMatch(/\bboard\b/i)
    expect(without).not.toMatch(/\bcards?\b/i)
    expect(buildTurnControlSection({ hasBoard: true })).toContain(BOARD_OWNER)
  })

  test('carries no other agent: nobody to hand a floor to', () => {
    const section = buildTurnControlSection({ hasBoard: true, canAsk: true })
    expect(section).not.toMatch(/colleague|leader|participant|SkipAnswer/i)
  })
})

describe('the agent directory', () => {
  const agents = [
    { id: 'a', name: 'Explore', description: 'Reads code', tools: ['Read'] },
    { id: 'b', name: 'general-purpose', self: true },
  ]

  test('lists the agents `Agent` can start, and nothing else', () => {
    const section = buildAgentDirectorySection(agents, { canDelegate: true })!
    expect(section).toContain('- Explore (subagent): Reads code (tools: Read)')
    expect(section).toContain('- general-purpose (subagent, yourself)')
    expect(section).not.toMatch(/@|priority|participant|tag/i)
  })

  test('a run that cannot delegate has no directory', () => {
    expect(buildAgentDirectorySection(agents, { canDelegate: false })).toBeNull()
    expect(buildAgentDirectorySection([], { canDelegate: true })).toBeNull()
  })
})
