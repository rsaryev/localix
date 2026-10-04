import { describe, expect, test } from 'bun:test'
import type { MenuEntry } from '@localixai/plugin-sdk/ui'

import { agentQuickActions, availableLaunchers } from './quickActions'
import type { LauncherState } from './launcherStore'
import type { AgentCliStatus } from './types'

const CLAUDE: AgentCliStatus = {
  provider: 'claude-code',
  label: 'Claude Code',
  executable: 'claude',
  available: true,
  path: '/opt/bin/claude',
}
const CODEX: AgentCliStatus = {
  provider: 'codex',
  label: 'Codex',
  executable: 'codex',
  available: false,
}

const Mark = () => null

function build(state: LauncherState, spy: { launched: AgentCliStatus[]; rechecks: number }) {
  return agentQuickActions({
    state,
    marks: { 'claude-code': Mark },
    onOpenRoster: () => {},
    onLaunch: (launcher) => spy.launched.push(launcher),
    onRecheck: () => {
      spy.rechecks += 1
    },
  })
}

const spy = () => ({ launched: [] as AgentCliStatus[], rechecks: 0 })

/**
 * Flat list of ids, submenu children included, for asserting what a person can actually reach.
 *
 * Headers carry no id and are not reachable, so they are `#name` rather than dropped — a group
 * that silently disappeared from this list would look exactly like one that renders.
 */
function ids(entries: readonly MenuEntry[]): string[] {
  return entries.flatMap((entry) =>
    'separator' in entry
      ? []
      : 'header' in entry
        ? [`#${entry.header}`]
        : 'items' in entry
          ? [entry.id, ...ids(entry.items)]
          : [entry.id],
  )
}

function find(entries: readonly MenuEntry[], id: string) {
  const flat: MenuEntry[] = entries.flatMap((entry) =>
    'separator' in entry || 'header' in entry
      ? []
      : 'items' in entry
        ? [entry, ...entry.items]
        : [entry],
  )
  return flat.find((entry) => 'id' in entry && entry.id === id)
}

describe('external agent quick actions', () => {
  test('offers only the CLIs that are actually installed', () => {
    const entries = build(
      { status: 'ready', launchers: [CLAUDE, CODEX], error: null, errorDetail: null },
      spy(),
    )
    // Codex is not on this machine. Listing it would open a pane that says "command not found",
    // which is an error report delivered by opening a window.
    expect(ids(entries)).toEqual(['open', '#Launch in terminal', 'launch:claude-code', 'recheck'])
  })

  test('the roster is reachable in every state, because it is the item’s other job', () => {
    for (const status of ['idle', 'loading', 'ready', 'error'] as const) {
      const entries = build({ status, launchers: [], error: 'nope', errorDetail: null }, spy())
      expect(ids(entries)).toContain('open')
    }
  })

  test('says it is checking rather than rendering an empty menu', () => {
    const entries = build(
      { status: 'loading', launchers: [], error: null, errorDetail: null },
      spy(),
    )
    const checking = find(entries, 'checking')
    expect(checking).toBeTruthy()
    expect(checking && 'disabled' in checking && checking.disabled).toBe(true)
    // Re-checking while a check runs is the one gesture that cannot help.
    const recheck = find(entries, 'recheck')
    expect(recheck && 'disabled' in recheck && recheck.disabled).toBe(true)
  })

  test('says so when the machine has none, instead of an empty submenu', () => {
    const entries = build(
      { status: 'ready', launchers: [CODEX], error: null, errorDetail: null },
      spy(),
    )
    expect(ids(entries)).toEqual(['open', 'none', 'recheck'])
    const none = find(entries, 'none')
    expect(none && 'label' in none && none.label).toBe('No agent CLIs found on PATH')
  })

  // The sentence alone was a dead end: the way out is each agent's install page, then Check again.
  test('with none installed, offers the install page of each agent that has one', () => {
    const installed: AgentCliStatus[] = []
    const entries = agentQuickActions({
      state: {
        status: 'ready',
        launchers: [{ ...CODEX, installUrl: 'https://github.com/openai/codex' }],
        error: null,
        errorDetail: null,
      },
      marks: {},
      onOpenRoster: () => {},
      onLaunch: () => {},
      onRecheck: () => {},
      onInstall: (launcher) => installed.push(launcher),
    })
    expect(ids(entries)).toEqual([
      'open',
      'none',
      '#Install an agent CLI',
      'install:codex',
      'recheck',
    ])
    const row = find(entries, 'install:codex')
    if (row && 'onSelect' in row) row.onSelect()
    expect(installed.map((launcher) => launcher.provider)).toEqual(['codex'])
  })

  test('shows the backend’s own sentence on failure, and keeps the raw text off the line', () => {
    const entries = build(
      {
        status: 'error',
        launchers: [],
        error: 'Could not check which agent CLIs are installed here.',
        errorDetail: 'EACCES: permission denied',
      },
      spy(),
    )
    const error = find(entries, 'error')
    expect(error && 'label' in error && error.label).toBe(
      'Could not check which agent CLIs are installed here.',
    )
    expect(JSON.stringify(entries)).not.toContain('EACCES')
  })

  test('a failed re-check keeps the launchers the last good reading found', () => {
    // The store preserves them; the menu must go on offering them rather than blanking out.
    const entries = build(
      { status: 'error', launchers: [CLAUDE], error: 'network', errorDetail: null },
      spy(),
    )
    expect(ids(entries)).toContain('launch:claude-code')
  })

  test('launching and re-checking reach their handlers', () => {
    const calls = spy()
    const entries = build(
      { status: 'ready', launchers: [CLAUDE, CODEX], error: null, errorDetail: null },
      calls,
    )
    const launch = find(entries, 'launch:claude-code')
    const recheck = find(entries, 'recheck')
    if (launch && 'onSelect' in launch) launch.onSelect()
    if (recheck && 'onSelect' in recheck) recheck.onSelect()
    expect(calls.launched).toEqual([CLAUDE])
    expect(calls.rechecks).toBe(1)
  })

  test('carries each provider’s own mark, so a row is identifiable without reading it', () => {
    const entries = build(
      { status: 'ready', launchers: [CLAUDE], error: null, errorDetail: null },
      spy(),
    )
    const launch = find(entries, 'launch:claude-code')
    expect(launch && 'icon' in launch && launch.icon).toBe(Mark)
  })

  test('keeps the catalog’s order, never one derived from what happens to be installed', () => {
    const second = { ...CODEX, available: true }
    expect(
      availableLaunchers({
        status: 'ready',
        launchers: [CLAUDE, second],
        error: null,
        errorDetail: null,
      }).map((launcher) => launcher.provider),
    ).toEqual(['claude-code', 'codex'])
  })
})
