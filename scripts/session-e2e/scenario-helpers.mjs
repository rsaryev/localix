/** What the session E2E scenarios share: the step script, a speaker's runs, the team check. */
import assert from 'node:assert/strict'

/**
 * A step script for the scripted provider, in a code span: a handle inside code is a reference,
 * so the person's message does not itself address (and, in a group, invite) the agents it scripts.
 */
export const script = (steps) => `\`SCRIPT${JSON.stringify(steps)}\``

/** The model requests of one speaker's runs in a session (auxiliary calls excluded). */
export const runs = (rt, session, speaker) =>
  rt.requests({ session, speaker }).filter((request) => request.stream)

export const lastRun = (rt, session, speaker = 'localix') => {
  const found = runs(rt, session, speaker).at(-1)
  assert.ok(found, `no ${speaker} run in ${session.title}`)
  return found
}

const TEAM_LINES = ['Bring in a suitable agent', 'elected leader', '## Leadership', '## Your part']

export function assertNoTeamProtocol(request) {
  for (const line of TEAM_LINES) assert.ok(!request.system.includes(line), `prompt has "${line}"`)
  assert.ok(!request.tools.includes('skip_answer'), 'holds skip_answer')
  assert.ok(!request.contextHeadings.includes('# Agent directory'), 'carries the agent directory')
}
