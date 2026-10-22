/** Session E2E: official marketplace plugins — security-guidance, commit-commands, code-review, skill-creator, feature-dev. */
import assert from 'node:assert/strict'
import { existsSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { runs, script } from './scenario-helpers.mjs'
import {
  SECURITY_TAG,
  childRun,
  delegateTo,
  gitCommit,
  gitIn,
  invocation,
  patternRulesOnly,
  read,
  withPlugins,
} from './scenarios-cc-official-helpers.mjs'

export const CC_OFFICIAL_COMMAND_SCENARIOS = [
  {
    name: 'cc-official: security-guidance — a Write of innerHTML code brings its warning to the model as a system reminder, a safe Write does not',
    async run(rt) {
      const patch = { 'security-guidance': patternRulesOnly }
      await withPlugins(rt, ['security-guidance'], { patch }, async ({ dir, session }) => {
        const safe = { files: [{ path: 'src/safe.js', content: 'el.textContent = name\n' }] }
        const risky = {
          files: [{ path: 'src/view.js', content: 'el.innerHTML = location.hash\n' }],
        }
        const steps = {
          localix: [{ tool: 'write', args: safe }, { tool: 'write', args: risky }, 'Written.'],
        }
        const after = await rt.say(session.id, `Render it. ${script(steps)}`)
        const [, afterSafe, afterRisky] = runs(rt, after, 'localix')
        // hooks.md: "Claude Code wraps the string in a system reminder and inserts it into the
        // conversation at the point where the hook fired. Claude reads the reminder on the next
        // model request".
        const warned = (request) => request.reminders.filter((text) => text.includes(SECURITY_TAG))
        assert.deepEqual(warned(afterSafe), [], 'the safe Write brought a warning')
        const [reminder] = warned(afterRisky)
        assert.ok(
          reminder?.includes('Setting innerHTML with untrusted content'),
          JSON.stringify(afterRisky.reminders),
        )
        // hookify README: warnings do not block; the file is written.
        assert.ok(existsSync(path.join(dir, 'src/view.js')), 'the risky Write did not run')
      })
    },
  },
  {
    name: 'cc-official: commit-commands — /commit-commands:commit inlines git status and keeps every tool, and its git calls make the commit',
    async run(rt) {
      await withPlugins(rt, ['commit-commands'], { git: true }, async ({ dir, session }) => {
        writeFileSync(path.join(dir, 'a.txt'), 'hello\n')
        const steps = {
          localix: [
            { tool: 'bash', args: { command: 'git add a.txt' } },
            { tool: 'bash', args: { command: gitCommit('Add a.txt') } },
            'Committed.',
          ],
        }
        const after = await rt.say(session.id, `/commit-commands:commit ${script(steps)}`)
        const [first] = runs(rt, after, 'localix')
        // skills.md: "Claude Code runs the command and replaces the line with its output before
        // Claude sees the skill content".
        assert.ok(read(first).includes('Current git status: On branch main'), read(first))
        const expanded = invocation(after)
        assert.ok(!expanded.includes('!`git'), 'the placeholders are replaced')
        assert.match(expanded, /Recent commits: [0-9a-f]+ init/)
        assert.match(expanded, /Untracked files:[\s\S]*a\.txt/)
        // skills.md: allowed-tools "does not restrict which tools are available".
        for (const tool of ['bash', 'read', 'write', 'edit']) assert.ok(first.tools.includes(tool))
        assert.match(gitIn(dir, 'log', '--oneline', '-1'), /Add a\.txt/, 'the commit was made')
        assert.equal(rt.transcript(after).at(-1).text, 'Committed.')
      })
    },
  },
  {
    name: 'cc-official: code-review — /code-review:code-review expands, and an argument no placeholder takes arrives as ARGUMENTS:',
    async run(rt) {
      await withPlugins(rt, ['code-review'], {}, async ({ session }) => {
        const after = await rt.say(
          session.id,
          `/code-review:code-review 42 ${script({ localix: ['Reviewing.'] })}`,
        )
        assert.ok(invocation(after).startsWith('Provide a code review for the given pull request.'))
        // skills.md: "If you invoke a skill with arguments but no placeholder in the skill's
        // content receives one, Claude Code appends `ARGUMENTS: <your input>`".
        assert.match(invocation(after), /\nARGUMENTS: 42\b/)
      })
    },
  },
  {
    name: 'cc-official: skill-creator — /skill-creator:skill-creator expands, and its argument arrives as ARGUMENTS:',
    async run(rt) {
      await withPlugins(rt, ['skill-creator'], {}, async ({ session }) => {
        // The script rides an earlier message: the argument is the request alone.
        await rt.say(session.id, `Get ready. ${script({ localix: ['Ready.', 'Drafting.'] })}`)
        const after = await rt.say(session.id, '/skill-creator:skill-creator a changelog skill')
        assert.match(invocation(after), /^# Skill Creator/)
        // skills.md: "Claude Code appends `ARGUMENTS: <your input>` to the end of the skill
        // content so Claude still sees what you typed".
        assert.match(invocation(after), /\nARGUMENTS: a changelog skill\s*$/)
      })
    },
  },
  {
    name: 'cc-official: feature-dev — /feature-dev:feature-dev expands with the request, and its three agents run as delegated types with their prompts and tools',
    async run(rt) {
      await withPlugins(rt, ['feature-dev'], {}, async ({ session }) => {
        const agents = ['code-explorer', 'code-architect', 'code-reviewer']
        const steps = {
          localix: [...agents.map((a) => delegateTo(`feature-dev:${a}`, `${a}-OK`)), 'Planned.'],
        }
        const after = await rt.say(
          session.id,
          `/feature-dev:feature-dev Add OAuth login ${script(steps)}`,
          { timeoutMs: 120_000 },
        )
        // skills.md: "$ARGUMENTS — All arguments passed when invoking the skill."
        assert.match(invocation(after), /^# Feature Development/)
        assert.match(invocation(after), /Initial request: Add OAuth login/)
        // The section is sent only when an enabled plugin offers agents. The request log keeps
        // each message's first 400 characters, so the names in it are not read here.
        const [parent] = runs(rt, after, 'localix')
        assert.ok(parent.contextHeadings.includes('# Agent types'), 'the agent types are sent')
        const prompts = {
          'code-explorer': 'You are an expert code analyst specializing in tracing',
          'code-architect': 'You are a senior software architect',
          'code-reviewer': 'You are an expert code reviewer specializing in modern software',
        }
        for (const agent of agents) {
          const child = childRun(rt, `${agent}-OK`)
          assert.ok(child, `feature-dev:${agent} never ran`)
          // plugins-reference.md: "an agent `reviewer` in plugin `deploy-tools` appears as
          // `deploy-tools:reviewer`"; sub-agents.md: the body "becomes the system prompt".
          assert.ok(child.system.includes(prompts[agent]), `${agent} runs with its prompt`)
          // sub-agents.md: `tools` — "Tools the subagent can use"; theirs name no Write or Edit.
          assert.ok(child.tools.includes('read') && child.tools.includes('search'), child.tools)
          for (const tool of ['write', 'edit'])
            assert.ok(!child.tools.includes(tool), `${agent} holds ${tool}`)
        }
        assert.equal(rt.transcript(after).at(-1).text, 'Planned.')
      })
    },
  },
  {
    name: 'cc-official: feature-dev — code-explorer’s tool list (BashOutput, KillShell, no Bash) gives it no shell',
    async run(rt) {
      await withPlugins(rt, ['feature-dev'], {}, async ({ session }) => {
        const steps = {
          localix: [delegateTo('feature-dev:code-explorer', 'EXPLORER-SHELL'), 'Ok.'],
        }
        await rt.say(session.id, `Explore. ${script(steps)}`, { timeoutMs: 120_000 })
        const child = childRun(rt, 'EXPLORER-SHELL')
        assert.ok(child, 'feature-dev:code-explorer never ran')
        // sub-agents.md: `tools` — "Tools the subagent can use"; tools-reference.md: BashOutput
        // reads a background shell's output and KillShell stops one; neither runs a command.
        assert.ok(!child.tools.includes('bash'), `tools: ${child.tools}`)
      })
    },
  },
]
