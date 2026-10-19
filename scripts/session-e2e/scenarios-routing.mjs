/**
 * Session E2E: group routing — a decision model corrects the address rules where it is confident.
 *
 * The scripted provider answers OpenRouter's `/systemone` from a `ROUTE{"choice":…,"p":…}` span in
 * the event's own text, and unconfidently (0.5) without one, so every other scenario routes by the
 * address rules alone.
 */
import assert from 'node:assert/strict'

import { runs, script } from './scenario-helpers.mjs'

const route = (choice, p) => `\`ROUTE${JSON.stringify({ choice, p })}\``
const decisions = (rt) => rt.requests().filter((entry) => entry.decision)
const group = (rt, title) =>
  rt.createSession({ title, conversationMode: 'group', handles: ['localix', 'checker'] })

export const ROUTING_SCENARIOS = [
  {
    name: 'group routing: an untagged message goes to the participant the model names',
    async run(rt) {
      const session = await group(rt, 'Routing to a specialist')
      const before = decisions(rt).length
      const steps = { checker: ['Verified: the totals add up.'] }
      const after = await rt.say(
        session.id,
        `Are the checkout totals right? ${route('checker', 0.95)} ${script(steps)}`,
      )
      assert.equal(rt.transcript(after).at(1)?.from, 'checker', 'the specialist answered first')
      assert.equal(runs(rt, after, 'localix').length, 0, 'the leader was not asked')
      const [asked] = decisions(rt).slice(before)
      assert.equal(asked?.decision.author, 'person')
      assert.deepEqual(asked?.decision.options, ['localix', 'checker'])
      assert.equal(asked?.decision.model, '~typesafe/jev-latest')
    },
  },
  {
    name: 'group routing: an unconfident pick leaves the untagged message with the leader',
    async run(rt) {
      const session = await group(rt, 'Routing unconfident')
      const after = await rt.say(
        session.id,
        `Are the checkout totals right? ${route('checker', 0.6)} ${script({ localix: ['Looking.'] })}`,
      )
      assert.equal(rt.transcript(after).at(1)?.from, 'localix')
      assert.equal(runs(rt, after, 'checker').length, 0)
    },
  },
  {
    name: 'group routing: an @ that only credits a colleague hands the floor back to the person',
    async run(rt) {
      const session = await group(rt, 'Routing a credit')
      const steps = {
        localix: [`Done — the layout follows what @checker proposed. ${route('person', 0.92)}`],
      }
      const after = await rt.say(session.id, `@localix finish the layout. ${script(steps)}`)
      assert.equal(runs(rt, after, 'checker').length, 0, 'the credited colleague was not assigned')
      assert.equal(rt.transcript(after).at(-1)?.from, 'localix')
    },
  },
  {
    name: 'group routing: a handoff by name without @ reaches that colleague',
    async run(rt) {
      const session = await group(rt, 'Routing by name')
      const steps = {
        localix: [`Drafted. Checker, please verify the totals. ${route('checker', 0.9)}`],
        checker: ['Verified.'],
      }
      const after = await rt.say(session.id, `@localix draft the release. ${script(steps)}`)
      assert.equal(runs(rt, after, 'checker').length >= 1, true, 'checker took the handoff')
      assert.ok(rt.transcript(after).some((row) => row.from === 'checker'))
    },
  },
]
