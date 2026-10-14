import { describe, expect, test } from 'bun:test'

import { releaseChildSurfaces } from './child-surfaces'

describe('a finished child puts away what it left open', () => {
  test('its pages and its panes — and nothing of its parent’s', () => {
    // The pages were closed and the panes were not: a child's interactive terminal outlived it,
    // open beside its parent's work in the workspace they share.
    const calls: unknown[] = []
    const panes: Record<string, string[]> = { child: ['pty-a', 'pty-b'], parent: ['pty-parent'] }
    releaseChildSurfaces(
      {
        streamRegistry: {
          publish: (_user: string, _session: string, event: unknown) => calls.push(event),
        } as never,
        terminalControl: {
          list: ({ sessionId }: { sessionId: string | null }) =>
            (panes[sessionId ?? ''] ?? []).map((terminalId) => ({ terminalId })),
          close: ({ sessionId, terminalId }: { sessionId: string | null; terminalId: string }) => {
            calls.push(['close-pane', sessionId, terminalId])
            return true
          },
        } as never,
      },
      'u1',
      'child',
    )

    expect(calls).toEqual([
      { type: 'preview.closed', sessionId: 'child', backgroundOnly: true },
      ['close-pane', 'child', 'pty-a'],
      ['close-pane', 'child', 'pty-b'],
    ])
  })
})
