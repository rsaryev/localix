import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { RosterFilters } from './RosterFilters'
import type { ProviderStatus } from '../model/types'

/**
 * Sub-agent transcripts are hidden by default and are most of what exists: 282 top-level sessions on
 * this machine against 1,822 with children, so 1,540 rows the workspace could not reach while the tool
 * could. `RosterQuery.includeChildren` was implemented in the fold and validated by the route the whole
 * time — the service even read it through a cast, because `RosterQuery` did not declare what
 * `StatsQuery` did.
 */
function status(over: Partial<ProviderStatus> = {}): ProviderStatus {
  return {
    provider: 'claude-code',
    displayName: 'Claude Code',
    roots: [{ path: '/home/.claude/projects', exists: true }],
    sessionCount: 118,
    childSessionCount: 1356,
    verified: true,
    ...over,
  }
}

type Drill = { key: string; label: string; value: string; onClear: () => void }

function render(
  over: { includeChildren?: boolean; providers?: ProviderStatus[]; drills?: Drill[] } = {},
) {
  return renderToStaticMarkup(
    <RosterFilters
      text=""
      onTextChange={() => {}}
      providers={over.providers ?? [status()]}
      providersError={null}
      activeProviders={[]}
      onToggleProvider={() => {}}
      includeChildren={over.includeChildren ?? false}
      onToggleChildren={() => {}}
      {...(over.drills ? { drills: over.drills } : {})}
    />,
  )
}

describe('the filter surface reaches sub-agent transcripts', () => {
  test('the toggle is present and carries how many are hidden behind it', () => {
    const html = render()

    expect(html).toContain('sub-agents')
    // The count comes from `ProviderStatus.childSessionCount`, which is why the strip states both
    // populations separately rather than folding them into one total.
    expect(html).toContain('1356')
  })

  test('it sums the count across providers rather than showing one of them', () => {
    const html = render({
      providers: [
        status(),
        status({ provider: 'codex', displayName: 'Codex', childSessionCount: 149 }),
      ],
    })

    expect(html).toContain('1505')
  })

  test('a provider that nests nothing contributes no count', () => {
    const html = render({
      providers: [
        status({ childSessionCount: undefined }),
        status({ provider: 'codex', childSessionCount: 149 }),
      ],
    })

    expect(html).toContain('149')
  })

  test('the toggle shows whether it is on, and says what that means', () => {
    expect(render({ includeChildren: true })).toContain('Showing sub-agent transcripts')
    expect(render({ includeChildren: false })).toContain('are hidden')
  })
})

describe('a filter chosen elsewhere is visible and leavable here', () => {
  /**
   * The statistics screen narrows the whole workspace — an agent, a project, a model — and the list
   * obeys. Until this row existed it obeyed SILENTLY: the reader saw a shorter list with every
   * control here reading "off" and no way to widen it again short of reloading the panel.
   */
  const drills: Drill[] = [
    { key: 'project', label: 'project', value: '/Users/…/sample-project', onClear: () => {} },
    { key: 'model', label: 'model', value: 'claude-opus-5', onClear: () => {} },
  ]

  test('each active drill is named with the value it is filtering by', () => {
    const html = render({ drills })

    expect(html).toContain('/Users/…/sample-project')
    expect(html).toContain('claude-opus-5')
  })

  test('it is a pressed control, not a caption — the same pill as the providers', () => {
    const html = render({ drills: [drills[1]!] })
    const chip = html.slice(html.lastIndexOf('<button', html.indexOf('claude-opus-5')))

    // A label a reader cannot click is the dead end this replaced.
    expect(chip).toContain('aria-pressed="true"')
  })

  test('nothing is drawn when nothing is narrowed', () => {
    expect(render()).not.toContain('aria-pressed="true"')
  })
})
