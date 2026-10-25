import { describe, expect, test } from 'bun:test'

import { workflowConcurrency } from './agent-route'

/** How many agents of a run go at once — Claude Code's rule. */
describe('workflowConcurrency', () => {
  test('16 by default, fewer on a small machine, and the Claude Code variable within 1–256', () => {
    expect(workflowConcurrency({}, 32)).toBe(16)
    expect(workflowConcurrency({}, 6)).toBe(4)
    expect(workflowConcurrency({}, 1)).toBe(1)
    expect(workflowConcurrency({ CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS: '40' }, 4)).toBe(40)
    expect(workflowConcurrency({ CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS: '999' }, 4)).toBe(256)
    expect(
      workflowConcurrency(
        {
          LOCALIX_WORKFLOW_MAX_CONCURRENT_AGENTS: '2',
          CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS: '40',
        },
        32,
      ),
    ).toBe(2)
  })
})
