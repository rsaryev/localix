/**
 * PRODUCTION-SHAPED prompts: the runs a host actually builds.
 *
 * The shape goldens render a run with no conversation at all, which no host produces: every
 * run is dispatched for an agent, so every production prompt carries turn control. These
 * scenarios state what a host knows about a run — the session's topic, its directory, the
 * delivery channel — and render what that run reads. They are committed beside the shape
 * goldens, so a change to any run's prompt is reviewed as text.
 *
 * The facts are the host's own (`chat/runtime/run/system-prompt-conversation.ts`): the
 * directory lists only the agents `Agent` can start, and exists only for a chat.
 */
import type { BuildAgentSystemPromptParams } from '../assemble'
import { fullPrompt, type PromptShapeKey } from './prompt-render'

interface HostRun {
  shape: PromptShapeKey
  params: Partial<BuildAgentSystemPromptParams>
  /** Tools the host withholds from the run (`policy.human.withheldTools`). */
  withheld?: Readonly<Record<string, string>>
}

const TOPIC = { title: 'Ship the release', goal: 'Release 1.4 is published' }

/** The registry beside a chat: the agents `Agent` can start. */
const DIRECTORY: BuildAgentSystemPromptParams['agentDirectory'] = [
  { id: 'agent-qa', name: 'qa', description: 'Verifies releases' },
]

/** A chat with its one agent. */
const CHAT: HostRun = {
  shape: 'orchestrator',
  params: { conversation: true, sessionTopic: TOPIC, agentDirectory: DIRECTORY },
}

/** A session that is not a chat: no directory, no topic. */
function closedSession(shape: PromptShapeKey): HostRun {
  return { shape, params: { conversation: true } }
}

const HOST_RUNS: Record<string, HostRun> = {
  'host-chat': CHAT,
  'host-chat-plan': {
    ...CHAT,
    params: { ...CHAT.params, planMode: { draftPath: '/repo/.localix/plans/s1/PLAN.md' } },
  },
  // An autonomous session: nobody is expected to answer, so the tools that only reach a person
  // are withheld and the turn contract says to proceed on a stated assumption.
  'host-chat-autonomous': {
    ...CHAT,
    withheld: { AskUserQuestion: 'human.answer', Configure: 'human.answer' },
  },
  'host-chat-channel': {
    ...CHAT,
    params: { ...CHAT.params, deliveryContext: { channel: 'messenger' } },
  },
  'host-subagent': closedSession('subagent'),
  'host-automation': closedSession('automation'),
}

/** Every production run, rendered: name → prompt. */
export function renderHostMatrix(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(HOST_RUNS).map(([name, run]) => [
      name,
      fullPrompt(run.shape, run.params, undefined, undefined, run.withheld),
    ]),
  )
}
