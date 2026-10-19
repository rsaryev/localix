/**
 * Behaviour checks against a REAL model (`run.mjs --real`): does an agent act the way its policy
 * tells it to, not only does the runtime route what it says.
 *
 * Two kinds of check. `must` is the runtime's guarantee — membership, mode, no pending card — and
 * fails the scenario. `expect` is the model's behaviour, which a prompt can only steer: it is
 * reported, with the transcript, for a person to judge. Prompts are short and ask for no files,
 * so a run costs a handful of turns on a cheap model.
 */
import assert from 'node:assert/strict'

/** Every `@handle` written in the agents' replies of a session. */
const taggedIn = (rt, session) =>
  rt
    .transcript(session)
    .filter((row) => row.from !== 'user')
    .flatMap((row) =>
      [...row.text.matchAll(/(?:^|\s)@([a-z0-9_-]+)/gi)].map((m) => m[1].toLowerCase()),
    )

/**
 * Replies that talk ABOUT the person in front of them, or recount the board's bookkeeping, instead
 * of saying what was done: the room the person reads should be written for them too.
 */
const OVER_THE_PERSONS_HEAD =
  /\bthe user\b|пользовател|\bticked\b|\bchecklist\b|sent (it|the card|the task) (to|for) review/i

const overTheHead = (rt, session) =>
  rt
    .transcript(session)
    .filter((row) => row.from !== 'user' && OVER_THE_PERSONS_HEAD.test(row.text))
    .map((row) => `${row.from}: ${row.text.slice(0, 160)}`)

/** The agents a session's delegated children run as. */
async function delegatedTo(rt, session) {
  const listed = await rt.api('/sessions')
  const all = Array.isArray(listed) ? listed : listed.sessions
  return all
    .filter((row) => row.parentSessionId === session.id)
    .flatMap((row) => row.agents.map((agent) => agent.handle))
}

export const BEHAVIOR = [
  {
    name: 'solo: asked for a team, the agent works alone and tags nobody',
    async run(rt, expect) {
      const session = await rt.createSession({ title: 'Real: solo team request' })
      const after = await rt.say(
        session.id,
        'I want a frontend specialist and a QA reviewer on this: outline a tiny landing page for a coffee shop and how it would be reviewed. Five bullets at most, no files.',
        { timeoutMs: 180_000 },
      )
      assert.deepEqual(
        after.agents.map((agent) => agent.handle),
        ['localix'],
        'nobody may join a solo chat',
      )
      assert.equal(after.conversationMode, 'solo')
      expect('the reply tags no agent', taggedIn(rt, after).length === 0, taggedIn(rt, after))
      // Delegation stays in solo: a specialist may still take a child task, never a seat.
      const children = await delegatedTo(rt, after)
      if (children.length) expect(`specialists worked as children: ${children.join(', ')}`, true)
      return after
    },
  },
  {
    name: 'group: the leader gets the work to the right colleague',
    async run(rt, expect) {
      const session = await rt.createSession({
        title: 'Real: group release',
        conversationMode: 'group',
      })
      const after = await rt.say(
        session.id,
        'Write three bullet release notes for v1.4 (faster sync, dark mode, bug fixes) and have them verified by whoever verifies releases. Keep every reply short and create no files.',
        { timeoutMs: 300_000 },
      )
      const joined = after.agents
        .map((agent) => agent.handle)
        .filter((handle) => handle !== 'localix')
      const children = await delegatedTo(rt, after)
      // Either is the rule's answer: a colleague joins for a part of the goal, a child takes a
      // self-contained check whose report is all the conversation needs (`# Collaboration`).
      expect(
        'the verification reached the verifier, in the room or as a child',
        joined.includes('checker') || children.includes('checker'),
        { joined, children },
      )
      expect(
        'the replies speak to the person, not over their head',
        !overTheHead(rt, after).length,
        overTheHead(rt, after),
      )
      return after
    },
  },
  {
    name: 'workflows: a greeting needs no team',
    async run(rt, expect) {
      const session = await rt.createSession({ title: 'Real: workflows greeting' })
      const after = await rt.say(session.id, '/workflows привет', { timeoutMs: 180_000 })
      const joined = after.agents.map((agent) => agent.handle).filter((h) => h !== 'localix')
      const replies = rt.transcript(after).filter((row) => row.from !== 'user')
      expect('nobody was brought in', joined.length === 0, joined)
      expect('answered in one reply', replies.length === 1, replies)
      return after
    },
  },
  {
    name: 'group → solo: after the switch the agent stops handing work on',
    async run(rt, expect) {
      const session = await rt.createSession({
        title: 'Real: back to solo',
        conversationMode: 'group',
        handles: ['localix', 'checker'],
      })
      await rt.say(session.id, 'Say hello to the team in one line.', { timeoutMs: 180_000 })
      await rt.api(`/sessions/${session.id}`, { agentIds: [rt.agentIds.localix] }, 'PATCH')
      await rt.api(`/sessions/${session.id}`, { conversationMode: 'solo' }, 'PATCH')
      const before = rt.transcript(await rt.detail(session.id)).length
      const after = await rt.say(
        session.id,
        'Ask the checker to verify the plan once more, then tell me the result in one line.',
        { timeoutMs: 180_000 },
      )
      assert.deepEqual(
        after.agents.map((agent) => agent.handle),
        ['localix'],
        'the checker came back',
      )
      const reply = rt.transcript(after).slice(before)
      expect(
        'the solo reply tags no agent',
        !reply.some((row) => /(^|\s)@checker\b/i.test(row.text)),
        reply,
      )
      return after
    },
  },
  {
    name: 'autonomous: the agent decides instead of asking',
    async run(rt, expect) {
      const session = await rt.createSession({ title: 'Real: autonomous' })
      await rt.api(`/sessions/${session.id}`, { permissionMode: 'autonomous' }, 'PATCH')
      const after = await rt.say(
        session.id,
        'Pick Postgres or SQLite for a single-user prototype and say why in two sentences.',
        { timeoutMs: 180_000 },
      )
      assert.equal(after.pendingInteraction, null, 'a card waits on a person nobody expects')
      const reply = rt.transcript(after).at(-1)?.text ?? ''
      expect('the reply names a choice', /sqlite|postgres/i.test(reply), reply)
      return after
    },
  },
]
