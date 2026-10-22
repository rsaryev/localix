/** Session E2E: a Claude Code plugin's workflow, run as its command with child agents. */
import assert from 'node:assert/strict'

import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { lastRun, runs, script } from './scenario-helpers.mjs'

// Each agent's task carries the step script its child answers with (`provider.mjs`).
const WORKFLOW = `export const meta = { name: 'audit', description: 'Audit each file' }
phase('Audit')
return pipeline(args.files, (file) =>
  agent('Audit ' + file + '. \`SCRIPT{"localix":["ok ' + file + '"]}\`', { label: file }),
)
`

/** Wait until the session's last message reads `text`: a background run reports in a later turn. */
async function settled(rt, sessionId, text, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const current = await rt.waitIdle(sessionId, { timeoutMs })
    if (rt.transcript(current).at(-1)?.text === text) return current
    if (Date.now() > deadline) throw new Error(`Session ${sessionId} never read "${text}"`)
  }
}

export const WORKFLOW_SCENARIOS = [
  {
    name: 'plugins: a plugin workflow runs as its command, one child per agent',
    async run(rt) {
      const dir = path.join(rt.root, 'acme')
      for (const [file, text] of Object.entries({
        '.claude-plugin/plugin.json': JSON.stringify({ name: 'acme', version: '1.0.0' }),
        'workflows/audit.js': WORKFLOW,
      })) {
        mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
        writeFileSync(path.join(dir, file), text)
      }
      await rt.api('/plugins/install', { source: dir, enable: true })
      try {
        const session = await rt.createSession({ title: 'Workflow' })
        const before = await rt.say(session.id, `Hello. ${script({ localix: ['Hello.'] })}`)
        assert.ok(!lastRun(rt, before).tools.includes('workflow'), 'no workflow before its command')

        const steps = {
          localix: [
            { tool: 'workflow', args: { name: 'acme:audit', args: { files: ['a.ts', 'b.ts'] } } },
            'The audit runs in the background.',
            'Both files audited.',
          ],
        }
        await rt.say(session.id, `/acme:audit a.ts b.ts ${script(steps)}`, { timeoutMs: 120_000 })
        // The run goes on in the background, as in Claude Code: the turn that started it ends at
        // once, and the run's end wakes the chat with its result in a turn of its own.
        const after = await settled(rt, session.id, 'Both files audited.')
        const children = rt
          .requests({ speaker: 'localix' })
          .filter((request) => request.stream && /^ok [ab]\.ts$/.test(request.answered.text ?? ''))
        assert.equal(children.length, 2, 'one child per agent()')
        const started = runs(rt, after).find((run) => run.tools.includes('workflow'))
        assert.ok(started, 'the command activated the tool')
        const wake = lastRun(rt, after)
        const report = wake.messages.map((message) => message.text).join('\n')
        assert.match(report, /Workflow acme:audit finished \(2 agents/)
        assert.match(report, /Run wf-[0-9a-f]{12}/)
        const texts = rt.transcript(after).map((message) => message.text)
        assert.ok(texts.includes('The audit runs in the background.'), 'the starting turn ended')
        assert.equal(texts.at(-1), 'Both files audited.')
      } finally {
        await rt.api('/plugins/remove', { name: 'acme' })
      }
    },
  },
]
