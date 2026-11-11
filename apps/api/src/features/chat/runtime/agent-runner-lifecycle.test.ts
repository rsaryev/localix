import { describe, expect, test } from 'bun:test'

import { testWork } from '../../../testing/work-fixture'
import { createRunnerLifecycle } from './agent-runner-lifecycle'
import { createRuntimeState } from './agent-runner-state'
import type { RunnerDeps } from './agent-runner-types'

describe('forgetting a deleted session', () => {
  test("forgets its kit plugin session and its mods with the rest of the session's runtime state", async () => {
    const forgotten: string[] = []
    const run = createRunnerLifecycle({
      deps: {
        agentRuntime: { disposeSession: async () => {} },
        pluginSessions: { forget: (id: string) => forgotten.push(id) },
        mods: { forget: async (id: string) => void forgotten.push(`mods:${id}`) },
      } as unknown as RunnerDeps,
      state: createRuntimeState(testWork()),
      wakeQueue: { forget: async () => {} } as never,
    })
    await run.forgetSession('u1', 's1')
    // Its conversation's mods host goes too, and the VMs its mods ran in.
    expect(forgotten).toEqual(['s1', 'mods:s1'])
  })
})
