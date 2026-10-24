/**
 * What a run tells its Claude Code hooks about the turn (hooks.md, "Common input fields", Stop
 * input): the prompt being answered (`prompt_id`), the effort level (`effort.level`,
 * `CLAUDE_EFFORT`), the model (SessionStart's `model`), and the session's running work and
 * scheduled loops (`background_tasks`, `session_crons`).
 *
 * Layer rule: run/ may import runtime infrastructure + agent-core, never features/chat/service*.
 */
import { getLoopEngine } from '../../../loops/runtime-binding'
import type { WorkRecord } from '../../../work/contracts'
import type { RunParams } from './types'

type CcEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

/** Localix's effort in Claude Code's levels: `minimal` reads as `low`, and `off` as none. */
const CC_EFFORT: Record<string, CcEffort | undefined> = {
  minimal: 'low',
  low: 'low',
  medium: 'medium',
  high: 'high',
  xhigh: 'xhigh',
  max: 'max',
}

/** The run's prompt, effort and model, for the hooks runtime's options. */
export function ccRunFacts(
  params: Pick<RunParams, 'historyMessages'>,
  effort: string | undefined,
  model: string,
): { promptId?: string; effort?: CcEffort; model?: string } {
  const prompt = [...(params.historyMessages ?? [])]
    .reverse()
    .find((m) => m.payload.role === 'user')
  const level = effort ? CC_EFFORT[effort] : undefined
  return {
    ...(prompt ? { promptId: prompt.id } : {}),
    ...(level ? { effort: level } : {}),
    ...(model ? { model } : {}),
  }
}

/** Claude Code caps a description, command or prompt at 1000 characters, marking the cut. */
function capped(text: string): string {
  return text.length <= 1000 ? text : `${text.slice(0, 1000)}… [+${text.length - 1000} chars]`
}

/** Claude Code's task-type label for a piece of Localix work. */
const TASK_TYPE: Record<WorkRecord['kind'], string> = {
  job: 'shell',
  promoted: 'shell',
  monitor: 'monitor',
  stream: 'stream',
  subagent: 'subagent',
}

/** The session's running work and its scheduled loops, as Stop and SubagentStop list them. */
export function ccBackgroundWork(
  work: { list(owner: { userId: string; sessionId: string }): WorkRecord[] },
  userId: string,
  sessionId: string,
): { background_tasks: unknown[]; session_crons: unknown[] } {
  const running = work.list({ userId, sessionId }).filter((record) => record.status === 'running')
  const loops = getLoopEngine()?.listForSession(userId, sessionId) ?? []
  return {
    background_tasks: running.map((record) => {
      const type = TASK_TYPE[record.kind] ?? record.kind
      return {
        id: record.displayId,
        type,
        status: record.status,
        description: capped(record.label),
        ...(type === 'shell' ? { command: capped(record.label) } : {}),
      }
    }),
    session_crons: loops.map((loop) => ({
      id: loop.id,
      schedule: loop.cron ?? '',
      recurring: true,
      prompt: capped(loop.prompt),
    })),
  }
}
