import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import type { ToolCardContribution } from '@localixai/mini-app-sdk/ui'

import { setEnabledPluginNames } from '@/shared/contrib/miniAppActivation'
import { registerToolCard, removeToolCardsOf, toolCardFor } from '@/shared/contrib/toolCards'
import { FALLBACK_META, toolDisplayLabel, toolMeta } from './meta'
import { contributedToolCard, getToolCard, TOOL_CARDS } from './registry'

/**
 * A plugin's tool reads through the same table as a built-in one (`host.toolCards`), and these are
 * the contract guards: each names the mutation that turns it red.
 */
const OWNER = 'tool-card-fixture'
const Icon = () => null
const Card = () => null

function contribution(tool: string, label = 'Board'): ToolCardContribution {
  return {
    tool,
    pluginName: OWNER,
    presentation: { label, noun: 'tasks', verb: 'Updating board', Icon, stackable: true },
    Component: Card,
  }
}

afterEach(() => {
  removeToolCardsOf(OWNER)
  setEnabledPluginNames(null)
})

describe('contributed tool presentation', () => {
  test('a plugin tool reads with its own row, the same object every time', () => {
    // MUTATION: drop the contributed lookup from `toolMeta` → the fallback wrench, red.
    setEnabledPluginNames(new Set([OWNER]))
    registerToolCard(contribution('fixture_board'))
    const meta = toolMeta('fixture_board')
    expect(meta).not.toBe(FALLBACK_META)
    expect(meta).toMatchObject({ label: 'Board', verb: 'Updating board', icon: Icon })
    // MUTATION: build a fresh object per call → stacking compares by identity and this reddens.
    expect(toolMeta('fixture_board')).toBe(meta)
    expect(toolDisplayLabel('fixture_board')).toBe('Board')
    expect(contributedToolCard('fixture_board')).toBe(Card)
    expect(getToolCard('fixture_board')).toBe(Card)
  })

  test('a disabled plugin leaves its tool generic', () => {
    // MUTATION: skip the activation gate in `toolCardFor` → red.
    setEnabledPluginNames(new Set())
    registerToolCard(contribution('fixture_board'))
    expect(toolMeta('fixture_board')).toBe(FALLBACK_META)
    expect(toolDisplayLabel('fixture_board')).toBe('fixture_board')
    expect(contributedToolCard('fixture_board')).toBeUndefined()
  })

  test('a plugin cannot restyle or replace a built-in tool', () => {
    // MUTATION: consult the contributed table before the core one → red.
    setEnabledPluginNames(new Set([OWNER]))
    registerToolCard(contribution('read', 'Hijacked'))
    expect(toolMeta('read').label).not.toBe('Hijacked')
    expect(contributedToolCard('read')).toBeUndefined()
    expect(getToolCard('read')).toBe(TOOL_CARDS.read)
  })

  test('the first owner of a tool name keeps it, and removal frees it', () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {})
    try {
      setEnabledPluginNames(new Set([OWNER]))
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
