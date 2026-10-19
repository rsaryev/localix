/** Session E2E: solo and group conversations, and switching between them mid-conversation. */
import assert from 'node:assert/strict'

import { assertNoTeamProtocol, lastRun, runs, script } from './scenario-helpers.mjs'

export const MODE_SCENARIOS = [
  {
    name: 'solo: a new chat starts solo and carries no team protocol',
    async run(rt) {
      const session = await rt.createSession({ title: 'Solo prompt' })
      assert.equal(session.conversationMode, 'solo')
      const after = await rt.say(
        session.id,
        `Plan the release. ${script({ localix: ['Planned.'] })}`,
      )
      assert.deepEqual(rt.transcript(after).at(-1), { from: 'localix', text: 'Planned.' })
      const request = lastRun(rt, after)
      assertNoTeamProtocol(request)
      assert.ok(request.tools.includes('set_topic'), 'the lone agent owns the topic')
      assert.ok(request.system.includes('# Conversation turn control'))
    },
  },
  {
    name: 'solo: a tag in the reply invites nobody and hands nothing on',
    async run(rt) {
      const session = await rt.createSession({ title: 'Solo reply tag' })
      const steps = { localix: ['@checker, verify the checkout.'], checker: ['Verified.'] }
      const after = await rt.say(session.id, `Ship it. ${script(steps)}`)
      assert.deepEqual(
        after.agents.map((agent) => agent.handle),
        ['localix'],
      )
      assert.equal(runs(rt, after, 'checker').length, 0, 'checker was given a turn')
      assert.equal(rt.transcript(after).at(-1).text, '@checker, verify the checkout.')
    },
  },
  {
    name: 'solo: a tag from the person invites nobody',
    async run(rt) {
      const session = await rt.createSession({ title: 'Solo person tag' })
      const after = await rt.say(
        session.id,
        `@checker look at this. ${script({ localix: ['On it.'] })}`,
      )
      assert.deepEqual(
        after.agents.map((agent) => agent.handle),
        ['localix'],
      )
      assert.equal(runs(rt, after, 'checker').length, 0)
      assert.equal(rt.transcript(after).at(-1).from, 'localix')
    },
  },
  {
    name: 'solo: a second agent is refused unless the same edit makes it a group',
    async run(rt) {
      const session = await rt.createSession({ title: 'Solo grows' })
      const both = [rt.agentIds.localix, rt.agentIds.checker]
      const refused = await rt.call(`/sessions/${session.id}`, { agentIds: both }, 'PATCH')
      assert.equal(refused.status, 409)
      assert.equal(refused.body.error.code, 'solo_needs_one_agent')
      const grown = await rt.api(
        `/sessions/${session.id}`,
        { agentIds: both, conversationMode: 'group' },
        'PATCH',
      )
      assert.equal(grown.conversationMode, 'group')
      assert.deepEqual(
        grown.agents.map((agent) => agent.handle),
        ['localix', 'checker'],
      )
      const kinds = rt.notices(await rt.detail(session.id)).map((notice) => notice.kind)
      assert.ok(kinds.includes('conversation_mode_change'), `notices: ${kinds}`)
      assert.ok(kinds.includes('participants_change'), `notices: ${kinds}`)
    },
  },
  {
    name: 'group: a lone agent keeps the invite rule and the directory',
    async run(rt) {
      const session = await rt.createSession({ title: 'Lone group', conversationMode: 'group' })
      const after = await rt.say(session.id, `Hi. ${script({ localix: ['Hello.'] })}`)
      const request = lastRun(rt, after)
      assert.ok(request.system.includes('Bring in a suitable agent'))
      assert.ok(request.contextHeadings.includes('# Agent directory'))
    },
  },
  {
    name: 'group: the leader tags a colleague in, who answers and reports back',
    async run(rt) {
      const session = await rt.createSession({ title: 'Group handoff', conversationMode: 'group' })
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
        conversationMode: 'group',
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
    name: 'group → solo: refused with several agents, then allowed, and the next run is solo',
    async run(rt) {
      const session = await rt.createSession({
        title: 'Back to solo',
        conversationMode: 'group',
        handles: ['localix', 'checker'],
      })
      const refused = await rt.call(
        `/sessions/${session.id}`,
        { conversationMode: 'solo' },
        'PATCH',
      )
      assert.equal(refused.status, 409)
      assert.equal(refused.body.error.code, 'solo_needs_one_agent')
      await rt.api(`/sessions/${session.id}`, { agentIds: [rt.agentIds.localix] }, 'PATCH')
      const solo = await rt.api(`/sessions/${session.id}`, { conversationMode: 'solo' }, 'PATCH')
      assert.equal(solo.conversationMode, 'solo')
      const after = await rt.say(session.id, `Continue. ${script({ localix: ['Continuing.'] })}`)
      assertNoTeamProtocol(lastRun(rt, after))
      const notice = rt.notices(after).find((row) => row.kind === 'conversation_mode_change')
      assert.match(notice?.text ?? '', /Solo/)
    },
  },
  {
    name: 'group → solo mid-turn: the running reply finishes, and its tag reaches nobody',
    async run(rt) {
      const session = await rt.createSession({
        title: 'Switch mid-turn',
        conversationMode: 'group',
        handles: ['localix', 'checker'],
      })
      const steps = {
        localix: [{ wait: 2500, text: '@checker, verify the build.' }],
        checker: ['Verified.'],
      }
      await rt.send(session.id, `Release it. ${script(steps)}`)
      await rt.waitRunning(session.id, 'localix')
      // While the leader is still answering: the person removes the colleague and goes solo.
      await rt.api(`/sessions/${session.id}`, { agentIds: [rt.agentIds.localix] }, 'PATCH')
      await rt.api(`/sessions/${session.id}`, { conversationMode: 'solo' }, 'PATCH')
      const after = await rt.waitIdle(session.id)
      assert.equal(after.conversationMode, 'solo')
      assert.deepEqual(
        after.agents.map((agent) => agent.handle),
        ['localix'],
      )
      assert.equal(runs(rt, after, 'checker').length, 0, 'the colleague was handed the floor')
      assert.equal(rt.transcript(after).at(-1).text, '@checker, verify the build.')
    },
  },
  {
    name: 'solo → group mid-conversation: the newcomer reads what was said before it joined',
    async run(rt) {
      const session = await rt.createSession({ title: 'Grow mid-conversation' })
      await rt.say(session.id, `Draft notes. ${script({ localix: ['Drafted: v1.4 notes.'] })}`)
      await rt.api(
        `/sessions/${session.id}`,
        { agentIds: [rt.agentIds.localix, rt.agentIds.checker], conversationMode: 'group' },
        'PATCH',
      )
      const steps = {
        localix: ['@checker, check the drafted notes.', 'Done — notes checked.'],
        checker: ['The notes read well.'],
      }
      const after = await rt.say(session.id, `Have them checked. ${script(steps)}`)
      const member = lastRun(rt, after, 'checker')
      // The solo turn is in the newcomer's view, as the colleague's words, never as its own.
      const earlier = member.messages.find((message) =>
        message.text.includes('Drafted: v1.4 notes.'),
      )
      assert.ok(earlier, 'the newcomer cannot see the earlier reply')
      assert.equal(earlier.role, 'user', 'a colleague reply arrived as the newcomer’s own')
      assert.ok(member.system.includes('## Your part'))
    },
  },
]
