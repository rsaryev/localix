/**
 * Behaviour checks against a REAL model (`run.mjs --real`): does an agent act the way its policy
 * tells it to, not only does the runtime route what it says.
 *
 * Two kinds of check. `must` is the runtime's guarantee — membership, no pending card — and
 * fails the scenario. `expect` is the model's behaviour, which a prompt can only steer: it is
 * reported, with the transcript, for a person to judge. Prompts are short and ask for no files,
 * so a run costs a handful of turns on a cheap model.
 */
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

/**
 * Replies that talk ABOUT the person in front of them, or recount the board's bookkeeping, instead
 * of saying what was done: the room the person reads should be written for them too.
 */
const OVER_THE_PERSONS_HEAD =
  /\bthe user\b|\u043f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u0435\u043b|\bticked\b|\bchecklist\b|sent (it|the card|the task) (to|for) review/i

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
    name: 'group: the leader gets the work to the right colleague',
    async run(rt, expect) {
      const session = await rt.createSession({ title: 'Real: group release' })
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
    name: 'workflow command: a greeting needs no team',
    async run(rt, expect) {
      const session = await rt.createSession({ title: 'Real: workflows greeting' })
      const after = await rt.say(session.id, '/workflows \u043f\u0440\u0438\u0432\u0435\u0442', {
        timeoutMs: 180_000,
      })
      const joined = after.agents.map((agent) => agent.handle).filter((h) => h !== 'localix')
      const replies = rt.transcript(after).filter((row) => row.from !== 'user')
      expect('nobody was brought in', joined.length === 0, joined)
      expect('answered in one reply', replies.length === 1, replies)
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
  {
    name: "board: a flow and a prioritisation are drawn as the board's own diagrams",
    async run(rt, expect) {
      // A throwaway project: the board is a file in the project, never the repository's.
      const dir = await mkdtemp(path.join(tmpdir(), 'localix-board-behaviour-'))
      const project = await rt.api('/projects', { name: 'Board behaviour', workingDir: dir })
      try {
        const session = await rt.createSession({ title: 'Real: board', projectId: project.id })
        const after = await rt.say(
          session.id,
          'On the project board, draw our release process: a pull request runs CI; green goes to review, then tag, then publish to the registry; red goes to a fix and back to CI. Beside it, place these ideas by impact and effort and mark the one to do first: offline mode, dark theme, new editor, rename settings, rewrite sync. Keep replies short and create no files.',
          { timeoutMs: 300_000 },
        )
        const { space } = await rt.api(`/project-space/space?sessionId=${session.id}`)
        const elements = Object.values(space.elements)
        const flows = elements.filter((element) => element.type === 'flow')
        const matrices = elements.filter((element) => element.type === 'quadrant')
        const steps = flows.flatMap((element) => element.props?.nodes ?? [])
        const points = matrices.flatMap((element) => element.props?.points ?? [])
        expect(
          'the process is one native flowchart',
          flows.length === 1,
          elements.map((e) => e.type),
        )
        expect(
          'it has the steps that were named',
          steps.length >= 5,
          steps.map((n) => n.label),
        )
        expect('the ideas are one native 2×2 matrix', matrices.length === 1, matrices.length)
        expect(
          'every idea is placed',
          points.length === 5,
          points.map((p) => p.label),
        )
        expect('the one to do first is focal', points.filter((p) => p.focal).length === 1, points)
        expect(
          'no loose shapes stand in for a diagram',
          !elements.some((element) => element.type === 'shape'),
          elements.map((e) => e.type),
        )
        expect(
          'the replies speak to the person, not over their head',
          !overTheHead(rt, after).length,
          overTheHead(rt, after),
        )
        return after
      } finally {
        await rt.call(`/projects/${project.id}`, undefined, 'DELETE')
        await rm(dir, { recursive: true, force: true })
      }
    },
  },
]
