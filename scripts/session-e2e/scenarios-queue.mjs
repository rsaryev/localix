/**
 * The wake queue, end to end: what is delivered together reaches the model as ONE turn, and what
 * the person types while the agent works reaches the running model — sent from the app's surface,
 * as the app sends it.
 */
import assert from 'node:assert/strict'

import { runs, script } from './scenario-helpers.mjs'

/** Every send from the app carries the workbench surface (`readyAgentRunToolSurface`). */
const APP_SURFACE = { capabilities: ['workbench-ui'] }

export const QUEUE_SCENARIOS = [
  {
    name: 'delegation: two background children → their delegator answers them once, together',
    async run(rt) {
      const session = await rt.createSession({ title: 'Report batch' })
      // Both children outlive the delegating run, so neither report can join it: they reach an
      // idle delegator, which must hear from them once — when the second is in.
      const child = (title, text, wait) => ({
        tool: 'delegate',
        args: { title, task: `${title}. ${script({ localix: [{ wait, text }] })}` },
      })
      const steps = {
        localix: [
          child('Draft notes', 'Notes drafted.', 3_500),
          child('Verify notes', 'Notes verified.', 5_000),
          'Both are running.',
          'Both reports are in.',
        ],
      }
      const after = await rt.say(session.id, `Draft and verify. ${script(steps)}`, {
        timeoutMs: 90_000,
        quietMs: 4_000,
      })
      const parent = runs(rt, after, 'localix')
      assert.equal(
        parent.length,
        4,
        `delegator requests: ${parent.map((r) => r.answered.text ?? r.answered.tool)}`,
      )
      const answer = parent.at(-1)
      assert.ok(
        answer.messages.some((message) => message.text.includes('2 delegated task reports')),
        'the reports did not arrive as one turn',
      )
      assert.equal(rt.transcript(after).at(-1).text, 'Both reports are in.')
    },
  },
  {
    name: "busy: the person's message sent from the app reaches the running model",
    async run(rt) {
      const session = await rt.createSession({ title: 'Interjection' })
      const steps = {
        localix: [{ wait: 2_500, text: 'First pass done.' }, 'Checked the logs too.'],
      }
      await rt.api(`/sessions/${session.id}/messages`, {
        prompt: `Look into it. ${script(steps)}`,
        toolSurface: APP_SURFACE,
      })
      // The model is answering its first request: the message must reach it at the next boundary.
      const running = await rt.waitRunning(session.id, 'localix')
      for (let i = 0; i < 100 && runs(rt, running, 'localix').length === 0; i++)
        await new Promise((resolve) => setTimeout(resolve, 50))
      await rt.api(`/sessions/${session.id}/messages`, {
        prompt: 'also check the logs',
        toolSurface: APP_SURFACE,
      })
      const after = await rt.waitIdle(session.id, { timeoutMs: 60_000 })
      const [first, second, ...more] = runs(rt, after, 'localix')
      assert.ok(second, 'the interjection was never answered')
      assert.equal(more.length, 0, 'the interjection opened a turn of its own')
      assert.ok(!first.messages.some((message) => message.text.includes('check the logs')))
      assert.ok(
        second.messages.some((message) => message.text.includes('while you were working')),
        'the interjection waited for a turn of its own instead of reaching the running model',
      )
    },
  },
]
