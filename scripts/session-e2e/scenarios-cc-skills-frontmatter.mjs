/** Session E2E: Claude Code plugin skills — invocation flags, tools, model and context: fork. */
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import path from 'node:path'

import { lastRun, runs, script } from './scenario-helpers.mjs'
import { md } from './scenarios-cc-helpers.mjs'
import {
  commandSpecs,
  invocations,
  lastCall,
  lastInstruction,
  loadTurn,
  resultOf,
  skillListing,
  toolResults,
  turnWithCards,
  untilQuiet,
  untilRequest,
  withAskRule,
  withPlugin,
} from './scenarios-cc-skills-helpers.mjs'

export const CC_SKILL_FRONTMATTER_SCENARIOS = [
  {
    name: 'cc-skills: disable-model-invocation hides the skill from the model, and /name still runs it',
    async run(rt) {
      const files = {
        'skills/secret/SKILL.md': md(
          ['description: DMI-DESC', 'disable-model-invocation: true'],
          'DMI-BODY',
        ),
        'skills/open/SKILL.md': md(['description: SHOWN-DESC'], 'SHOWN-BODY'),
      }
      await withPlugin(rt, 'dmi', files, async () => {
        const session = await rt.createSession({ title: 'Model invocation off' })
        const list = script({ localix: [{ tool: 'skill', args: { action: 'list' } }, 'Listed.'] })
        let after = await rt.say(session.id, `List. ${list}`)
        // skills: "`disable-model-invocation: true` | Yes | Not on its own | Description not in
        // context, full skill loads when invoked"; "(default) | ... | Description always in
        // context". The skill tool's own listing is part of that context.
        const listing = skillListing(lastRun(rt, after).system)
        assert.ok(listing.includes('SHOWN-DESC'), 'the plugin’s other skill is not listed')
        assert.ok(!lastRun(rt, after).system.includes('DMI-DESC'), 'its description is listed')
        const listed = resultOf(lastCall(after, 'skill'))
        assert.ok(listed.includes('SHOWN-DESC'), listed)
        assert.ok(!listed.includes('DMI-DESC'), `the skill tool lists it: ${listed}`)
        after = await rt.say(session.id, '/dmi:secret')
        assert.equal(lastInstruction(after), 'DMI-BODY')
      })
    },
  },
  {
    name: 'cc-skills: the skill tool refuses a disable-model-invocation skill',
    async run(rt) {
      const body = md(['description: D', 'disable-model-invocation: true'], 'DMB-BODY')
      await withPlugin(rt, 'dmb', { 'skills/secret/SKILL.md': body }, async () => {
        const session = await rt.createSession({ title: 'Blocked load' })
        const after = await loadTurn(rt, session, 'dmb:secret')
        // skills: "If Claude tries anyway, Claude Code blocks the call and instructs it not to
        // reproduce the deploy steps another way".
        const call = lastCall(after, 'skill')
        const result = resultOf(call)
        assert.equal(call.status, 'failed', `the call was not blocked: ${result.slice(0, 200)}`)
        assert.ok(!result.includes('DMB-BODY'), `the model loaded it: ${result.slice(0, 200)}`)
      })
    },
  },
  {
    name: 'cc-skills: user-invocable: false keeps the skill for the model and refuses /name',
    async run(rt) {
      const body = md(['description: UIF-DESC', 'user-invocable: false'], 'UIF-BODY')
      await withPlugin(rt, 'uif', { 'skills/bg/SKILL.md': body }, async () => {
        const session = await rt.createSession({ title: 'Model only' })
        // skills: "`user-invocable: false` | No | Yes | Description always in context".
        let after = await loadTurn(rt, session, 'uif:bg')
        assert.ok(skillListing(lastRun(rt, after).system).includes('UIF-DESC'))
        assert.ok(toolResults(after, 'skill').at(-1)?.includes('UIF-BODY'))
        // skills: "Claude Code hides it from the `/` menu and doesn't run it when you type
        // `/name`".
        const before = runs(rt, after, 'localix').length
        after = await rt.say(session.id, '/uif:bg')
        assert.equal(invocations(after).length, 0, 'the skill ran')
        assert.equal(runs(rt, after, 'localix').length, before, 'the model was asked')
        assert.ok(!(await commandSpecs(rt)).some((s) => s.fullName === 'uif:bg'), 'in the menu')
      })
    },
  },
  {
    name: 'cc-skills: allowed-tools pre-approves for the invoking turn and restricts nothing; disallowed-tools removes a tool for that turn only',
    async run(rt) {
      const mark = (label) => path.join(rt.root, `tls-mark-${label}`)
      const touch = (label) => ({ tool: 'bash', args: { command: `touch "${mark(label)}"` } })
      const grant = `TLS-GRANT ${script({ localix: [touch('granted'), 'Ran.'] })}`
      const files = {
        'skills/grant/SKILL.md': md(['description: G', 'allowed-tools: Bash'], grant),
        'skills/deny/SKILL.md': md(['description: D', 'disallowed-tools: Bash'], 'TLS-DENY'),
      }
      // Localix's default agent runs a shell command without asking; an ask over every command
      // stands in for Claude Code's default, which prompts for a command no rule allows.
      await withAskRule(rt, '*', () =>
        withPlugin(rt, 'tls', files, async () => {
          const session = await rt.createSession({ title: 'Skill tools' })
          // skills: "`allowed-tools` | Tools Claude can use without asking permission during the
          // turn that invokes this skill".
          const granted = await turnWithCards(rt, session.id, '/tls:grant')
          assert.equal(granted.cards, 0, 'the pre-approved call asked the person')
          assert.ok(existsSync(mark('granted')), 'the pre-approved call did not run')
          // skills: "It does not restrict which tools are available: every tool remains callable".
          const run = lastRun(rt, granted.session)
          assert.ok(run.tools.includes('read') && run.tools.includes('write'), `${run.tools}`)
          // skills: "The grant clears when you send your next message".
          const next = `Again. ${script({ localix: [touch('later'), 'Ran.'] })}`
          const later = await turnWithCards(rt, session.id, next)
          assert.equal(later.cards, 1, 'the grant outlived its turn')
          assert.ok(!existsSync(mark('later')), 'the dismissed call ran')
          // skills: "`disallowed-tools` | Tools removed from Claude's available pool while this
          // skill is active ... The restriction clears when you send your next message."
          let after = await rt.say(session.id, '/tls:deny')
          assert.ok(!lastRun(rt, after).tools.includes('bash'), 'bash stayed in the pool')
          after = await rt.say(session.id, `Next. ${script({ localix: ['Next.'] })}`)
          assert.ok(lastRun(rt, after).tools.includes('bash'), 'bash did not come back')
        }),
      )
    },
  },
  {
    name: 'cc-skills: an ask rule still prompts for a tool the skill’s allowed-tools grants',
    known:
      'A skill’s allowed-tools answers a named ask rule (`tool:bash touch *` ask): the call runs without a card.',
    async run(rt) {
      const mark = (label) => path.join(rt.root, `tla-mark-${label}`)
      const touch = (label) => ({ tool: 'bash', args: { command: `touch "${mark(label)}"` } })
      const body = md(
        ['description: G', 'allowed-tools: Bash'],
        `TLA-GRANT ${script({ localix: [touch('granted'), 'Ran.'] })}`,
      )
      await withAskRule(rt, 'touch *tla-mark-*', () =>
        withPlugin(rt, 'tla', { 'skills/grant/SKILL.md': body }, async () => {
          const session = await rt.createSession({ title: 'Ask over a grant' })
          // Without the skill, the rule asks.
          const plain = `Plain. ${script({ localix: [touch('plain'), 'Ran.'] })}`
          assert.equal((await turnWithCards(rt, session.id, plain)).cards, 1, 'the rule never asks')
          // skills: "Deny and ask rules still override `allowed-tools`"; permissions: "a matching
          // ask rule prompts even when a more specific allow rule also matches the same call".
          const granted = await turnWithCards(rt, session.id, '/tla:grant')
          assert.equal(granted.cards, 1, 'the grant answered the ask rule')
          assert.ok(!existsSync(mark('granted')), 'the dismissed call ran')
        }),
      )
    },
  },
  {
    name: 'cc-skills: a skill’s model runs the invoking turn, then the session model resumes',
    async run(rt) {
      const body = md(['description: M', 'model: gpt-4o-mini'], 'MDL-SKILL')
      await withPlugin(rt, 'mdl', { 'skills/fast/SKILL.md': body }, async () => {
        const session = await rt.createSession({ title: 'Skill model' })
        const models = []
        for (const prompt of ['/mdl:fast', 'Next.'])
          models.push(lastRun(rt, await rt.say(session.id, prompt)).model)
        // skills: "`model` | Model to use when this skill is active. The override applies for the
        // rest of the current turn ... The session model resumes when you send your next prompt."
        assert.deepEqual(models, ['gpt-4o-mini', 'gpt-4o'])
      })
    },
  },
  {
    name: 'cc-skills: context: fork runs the skill content as a subagent’s task without the conversation',
    async run(rt) {
      const task = `FORK-TASK ${script({ localix: ['FORK-DONE'] })}`
      const body = md(['description: F', 'context: fork'], task)
      await withPlugin(rt, 'frk', { 'skills/away/SKILL.md': body }, async () => {
        const session = await rt.createSession({ title: 'Forked skill' })
        await rt.say(session.id, `PARENT-HISTORY ${script({ localix: ['Noted.'] })}`)
        const after = await rt.say(session.id, '/frk:away')
        const parentRef = `LOCALIX-${after.seq}`
        // skills: "Claude Code starts a new subagent ... and gives it the skill content as its
        // prompt. The subagent doesn't see your conversation history".
        const child = await untilRequest(
          rt,
          (r) => r.sessionId !== parentRef && r.messages.some((m) => m.text.includes('FORK-TASK')),
        )
        const read = child.messages.map((m) => m.text).join('\n')
        assert.ok(!read.includes('PARENT-HISTORY'), 'the fork read the conversation')
        await untilQuiet(rt, session.id)
        const inline = runs(rt, await rt.detail(session.id), 'localix').filter((r) =>
          r.messages.some((m) => m.text.includes('FORK-TASK')),
        )
        assert.equal(inline.length, 0, 'the skill ran in the conversation instead')
      })
    },
  },
  {
    name: 'cc-skills: context: fork with agent runs the skill as that subagent type',
    async run(rt) {
      const agent = md(['name: reviewer', 'description: Reviews'], 'You are FORK-REVIEWER.')
      const body = md(
        ['description: F', 'context: fork', 'agent: fka:reviewer'],
        `FKA-TASK ${script({ localix: ['FKA-DONE'], reviewer: ['FKA-DONE'] })}`,
      )
      const files = { 'agents/reviewer.md': agent, 'skills/review/SKILL.md': body }
      await withPlugin(rt, 'fka', files, async () => {
        const session = await rt.createSession({ title: 'Forked agent' })
        const after = await rt.say(session.id, '/fka:review')
        const parentRef = `LOCALIX-${after.seq}`
        // skills: "Skill with `context: fork` | System prompt: From agent type"; "The `agent`
        // field determines the execution environment (model, tools, and permissions)".
        const child = await untilRequest(
          rt,
          (r) => r.sessionId !== parentRef && r.messages.some((m) => m.text.includes('FKA-TASK')),
        )
        await untilQuiet(rt, session.id)
        assert.ok(child.system.includes('You are FORK-REVIEWER.'), 'not the agent’s prompt')
      })
    },
  },
]
