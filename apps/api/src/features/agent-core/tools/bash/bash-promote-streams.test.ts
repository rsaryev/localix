import { expect, test } from 'bun:test'

import { MAX_BACKGROUND_JOBS_PER_SESSION, promoteTimedOutCommand } from './bash-promote'
import type { BashToolDetails } from './bash-types'

// A timed-out command that cannot become a job is a foreground result: a PostToolUse hook reads
// its `stdout` and `stderr` apart, as it does for any other.
test('a timeout at the job cap reports each stream on its own', async () => {
  const result = await promoteTimedOutCommand({
    detached: { child: { kill: () => true }, stdout: 'partial\n', stderr: 'slow disk\n' },
    command: 'make',
    cwd: '/repo',
    timeoutSecs: 5,
    wallTimeMs: 5000,
    onUpdate: undefined,
    context: { asyncRegistry: { countBackgroundJobs: () => MAX_BACKGROUND_JOBS_PER_SESSION } },
  } as never)
  const details = result.details as BashToolDetails
  expect(details.stdout).toBe('partial')
  expect(details.stderr).toBe('slow disk')
})
