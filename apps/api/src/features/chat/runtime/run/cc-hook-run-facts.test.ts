import { describe, expect, it } from 'bun:test'

import type { WorkRecord } from '../../../work/contracts'
import { ccBackgroundWork, ccRunFacts } from './cc-hook-run-facts'

const message = (id: string, role: string) => ({ id, payload: { role } }) as never

describe('what a run tells its hooks', () => {
  it('prompt_id is the latest user message; effort in Claude Code levels', () => {
    const history = [message('u1', 'user'), message('a1', 'assistant'), message('u2', 'user')]
    expect(ccRunFacts({ historyMessages: history }, 'minimal', 'm')).toEqual({
      promptId: 'u2',
      effort: 'low',
      model: 'm',
    })
    expect(ccRunFacts({ historyMessages: [] }, 'off', '').effort).toBeUndefined()
  })

  it('background_tasks lists running work in Claude Code task types', () => {
    const records = [
      { displayId: 'bg-1', kind: 'job', label: 'tail -f log', status: 'running' },
      { displayId: 'bg-2', kind: 'job', label: 'done', status: 'succeeded' },
      { displayId: 'mon-1', kind: 'monitor', label: 'errors', status: 'running' },
    ] as WorkRecord[]
    const work = ccBackgroundWork({ list: () => records }, 'u', 's')
    expect(work.background_tasks).toEqual([
      {
        id: 'bg-1',
        type: 'shell',
        status: 'running',
        description: 'tail -f log',
        command: 'tail -f log',
      },
      { id: 'mon-1', type: 'monitor', status: 'running', description: 'errors' },
    ])
    expect(work.session_crons).toEqual([])
  })
})
