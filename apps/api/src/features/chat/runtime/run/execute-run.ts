/**
 * One agent run, as a chain of stages — `stages/`, one file per stage, in the order below.
 * The run's policy (`stages/policy.ts`) is resolved first and travels on the resolved turn.
 *
 * The run used to be one 1100-line function in which a stage's inputs could only be found by
 * reading everything above it. Each stage now receives exactly the earlier results it reads,
 * so the dependency order is the call order. The state that must survive a throw — the
 * rebound session, the run row, the current assistant row, what teardown releases — lives on
 * the `RunFrame` the failure path and teardown read (see `stages/frame.ts`).
 *
 * Independent prompt inputs start as promises before their stage's first await so model setup
 * stays concurrent (the tool gather with the session roster, the run row with history
 * materialization); a further split must keep those pairs inside one stage.
 */
import { runtimeRunAdmission } from '../run-admission'
import type { RunExecutionOutcome } from '../run-outcome'
import { teardownRun } from './run-teardown'
import { admitRun } from './stages/admit'
import { completeRun } from './stages/complete'
import { prepareRunInputs } from './stages/context'
import { resolveRunStanding } from './stages/policy'
import { failRun } from './stages/fail'
import { materializeRunHistory } from './stages/history'
import { intakeRunTurn } from './stages/intake'
import { buildRunPrompt } from './stages/prompt'
import { streamRun } from './stages/stream'
import { assembleRunToolset } from './stages/tools'
import { resolveRunTurn } from './stages/turn'
import { resolveRunView, reviewRunView } from './stages/view'
import type { RunEnv, RunParams } from './types'

export async function executeRun(env: RunEnv, params: RunParams): Promise<RunExecutionOutcome> {
  const ticket = runtimeRunAdmission(env.state).enter(params.session.id)
  try {
    return await executeAdmittedRun(env, params, ticket.assertValid)
  } finally {
    ticket.release()
  }
}

async function executeAdmittedRun(
  env: RunEnv,
  params: RunParams,
  assertAdmitted: () => void,
): Promise<RunExecutionOutcome> {
  // Admission releases its own slot when it fails; from here on teardown owns it.
  const frame = await admitRun(env, params, assertAdmitted)
  try {
    const turn = await resolveRunTurn(frame, await resolveRunStanding(frame))
    const view = await resolveRunView(frame, turn)
    const inputs = await prepareRunInputs(frame, turn, view)
    const toolset = await assembleRunToolset(frame, turn, inputs)
    const prompt = await buildRunPrompt(frame, turn, inputs, toolset)
    const intake = await intakeRunTurn(frame, turn, inputs, toolset, prompt)
    const history = await materializeRunHistory(
      frame,
      turn,
      toolset,
      prompt,
      intake,
      await reviewRunView(view, inputs.mods),
      inputs.defaultCwd,
    )
    const streamed = await streamRun(frame, turn, inputs, toolset, prompt, intake, history)
    return await completeRun(frame, turn, inputs, intake, streamed)
  } catch (error) {
    return await failRun(frame, error)
  } finally {
    teardownRun({
      env,
      runtimeState: env.state,
      session: frame.session,
      abort: frame.abort,
      pluginHooksForRun: frame.teardown.pluginHooks,
      ccHooksForRun: frame.teardown.ccHooks,
      runLiveResolverKeys: frame.teardown.liveResolverKeys,
      unsubLsp: frame.teardown.unsubLsp,
      defaultCwd: frame.teardown.defaultCwd,
    })
  }
}
