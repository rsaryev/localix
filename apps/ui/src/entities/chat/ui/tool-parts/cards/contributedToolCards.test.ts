import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import type { ToolCardContribution } from '@localixai/mini-app-sdk/ui'

import { setEnabledMiniAppNames } from '@/shared/contrib/miniAppActivation'
import { registerToolCard, removeToolCardsOf, toolCardFor } from '@/shared/contrib/toolCards'
import { FALLBACK_META, toolMeta, toolSummaryNoun } from './meta'
import { contributedToolCard, getToolCard, TOOL_CARDS } from './registry'

/**
 * A mini app's tool reads through the same table as a built-in one (`host.toolCards`), and these
 * are the contract guards: each names the mutation that turns it red.
 */
const OWNER = 'tool-card-fixture'
const Icon = () => null
const Card = () => null

function contribution(tool: string, label = 'Updated'): ToolCardContribution {
  return {
    tool,
    miniAppName: OWNER,
    presentation: { label, noun: 'board tasks', verb: 'Updating', Icon, stackable: true },
    Component: Card,
  }
}

afterEach(() => {
  removeToolCardsOf(OWNER)
  setEnabledMiniAppNames(null)
})

describe('contributed tool presentation', () => {
  test('a mini app tool reads with its own row, the same object every time', () => {
    // MUTATION: drop the contributed lookup from `toolMeta` → the fallback wrench, red.
    setEnabledMiniAppNames(new Set([OWNER]))
    registerToolCard(contribution('fixture_board'))
    const meta = toolMeta('fixture_board')
    expect(meta).not.toBe(FALLBACK_META)
    expect(meta).toMatchObject({ label: 'Updated', verb: 'Updating', icon: Icon })
    // MUTATION: build a fresh object per call → stacking compares by identity and this reddens.
    expect(toolMeta('fixture_board')).toBe(meta)
    expect(toolSummaryNoun('fixture_board')).toBe('board tasks')
    expect(contributedToolCard('fixture_board')).toBe(Card)
    expect(getToolCard('fixture_board')).toBe(Card)
  })

  test('a disabled mini app leaves its tool generic', () => {
    // MUTATION: skip the activation gate in `toolCardFor` → red.
    setEnabledMiniAppNames(new Set())
    registerToolCard(contribution('fixture_board'))
    expect(toolMeta('fixture_board')).toBe(FALLBACK_META)
    expect(toolSummaryNoun('fixture_board')).toBe('fixture_board calls')
    expect(contributedToolCard('fixture_board')).toBeUndefined()
  })

  test('a mini app cannot restyle or replace a built-in tool', () => {
    // MUTATION: consult the contributed table before the core one → red.
    setEnabledMiniAppNames(new Set([OWNER]))
    registerToolCard(contribution('Read', 'Hijacked'))
    expect(toolMeta('Read').label).not.toBe('Hijacked')
    expect(contributedToolCard('Read')).toBeUndefined()
    expect(getToolCard('Read')).toBe(TOOL_CARDS.Read)
  })

  test('the first owner of a tool name keeps it, and removal frees it', () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {})
    try {
      setEnabledMiniAppNames(new Set([OWNER]))
      const first = contribution('fixture_board', 'First')
      registerToolCard(first)
      registerToolCard(contribution('fixture_board', 'Second'))
      expect(toolCardFor('fixture_board')).toBe(first)
      const duplicates = warn.mock.calls.filter(([message]) =>
        String(message).includes('duplicate tool card "fixture_board"'),
      )
      expect(duplicates).toHaveLength(1)
      removeToolCardsOf(OWNER)
      expect(toolMeta('fixture_board')).toBe(FALLBACK_META)
    } finally {
      warn.mockRestore()
    }
  })
})
