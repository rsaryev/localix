/** Session E2E: agents sharing a conversation — invitations, hand-offs and passes. */
import assert from 'node:assert/strict'

import { lastRun, runs, script } from './scenario-helpers.mjs'

export const GROUP_SCENARIOS = [
  {
    name: 'a lone agent keeps the invite rule and the directory',
    async run(rt) {
      const session = await rt.createSession({ title: 'Lone agent' })
      const after = await rt.say(session.id, `Hi. ${script({ localix: ['Hello.'] })}`)
      const request = lastRun(rt, after)
      assert.ok(request.system.includes('Bring in a suitable agent'))
      assert.ok(request.contextHeadings.includes('# Agent directory'))
    },
  },
  {
    name: 'group: the leader tags a colleague in, who answers and reports back',
    async run(rt) {
      const session = await rt.createSession({ title: 'Group handoff' })
      const steps = {
        localix: ['@checker, verify the checkout flow.', 'Thanks — the release is ready.'],
        checker: ['Verified: checkout passes.'],
      }
      const after = await rt.say(session.id, `Prepare the release. ${script(steps)}`)
      assert.deepEqual(
        after.agents.map((agent) => agent.handle),
        ['localix', 'checker'],
      )
      assert.deepEqual(
        rt
          .transcript(after)
          .slice(1)
          .map((row) => `${row.from}: ${row.text}`),
        [
          'localix: @checker, verify the checkout flow.',
          'checker: Verified: checkout passes.',
          'localix: Thanks — the release is ready.',
        ],
      )
      const member = lastRun(rt, after, 'checker')
      assert.ok(member.system.includes('## Your part'), 'the colleague reads the member contract')
      assert.ok(member.tools.includes('skip_answer'))
      assert.ok(!member.tools.includes('set_topic'), 'only the leader owns the topic')
      assert.ok(member.contextHeadings.includes('# Current turn'))
      assert.ok(lastRun(rt, after).system.includes('## Leadership'))
    },
  },
  {
    name: 'group: a colleague named with nothing to do passes, and nothing is routed back',
    async run(rt) {
      const session = await rt.createSession({
        title: 'Group pass',
        handles: ['localix', 'checker'],
      })
      const steps = {
        localix: ['FYI @checker, the notes are drafted; nothing for you.'],
        checker: [{ tool: 'skip_answer' }],
      }
      const after = await rt.say(session.id, `Draft the notes. ${script(steps)}`)
      assert.equal(runs(rt, after, 'checker').length, 1, 'checker took exactly one turn')
      assert.equal(runs(rt, after, 'localix').length, 1, 'the pass handed the floor back')
      assert.equal(rt.transcript(after).at(-1).from, 'localix')
    },
  },
  {
    name: 'a newcomer reads what was said before it joined',
    async run(rt) {
      const session = await rt.createSession({ title: 'Grow mid-conversation' })
      await rt.say(session.id, `Draft notes. ${script({ localix: ['Drafted: v1.4 notes.'] })}`)
      await rt.api(
        `/sessions/${session.id}`,
        { agentIds: [rt.agentIds.localix, rt.agentIds.checker] },
        'PATCH',
      )
      const steps = {
        localix: ['@checker, check the drafted notes.', 'Done — notes checked.'],
        checker: ['The notes read well.'],
      }
      const after = await rt.say(session.id, `Have them checked. ${script(steps)}`)
      const member = lastRun(rt, after, 'checker')
      // The earlier turn is in the newcomer's view, as the colleague's words, never as its own.
      const earlier = member.messages.find((message) =>
        message.text.includes('Drafted: v1.4 notes.'),
      )
      assert.ok(earlier, 'the newcomer cannot see the earlier reply')
      assert.equal(earlier.role, 'user', 'a colleague reply arrived as the newcomer’s own')
      assert.ok(member.system.includes('## Your part'))
    },
  },
]
