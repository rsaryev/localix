/** Session E2E: Claude Code plugin skills — frontmatter hooks, plugin commands and a disabled plugin. */
import assert from 'node:assert/strict'

import { lastRun } from './scenario-helpers.mjs'
import { md } from './scenarios-cc-helpers.mjs'
import {
  bashTurn,
  commandSpecs,
  invocations,
  lastCall,
  lastInstruction,
  loadTurn,
  replyOf,
  resultOf,
  skillListing,
  toolItems,
  withHookSkill,
  withPlugin,
} from './scenarios-cc-skills-helpers.mjs'

export const CC_SKILL_HOOK_COMMAND_SCENARIOS = [
  {
    name: 'cc-skills: a skill’s frontmatter hooks register when it is invoked, with the plugin root',
    async run(rt) {
      await withHookSkill(rt, 'hka', async ({ session, calls, env, record }) => {
        await bashTurn(rt, session, 'echo HOOK-BEFORE')
        // hooks: "Skill hooks: Claude Code registers them when you or Claude invoke the skill".
        assert.equal(calls().length, 0, 'the hook ran before the skill was invoked')
        await rt.say(session.id, '/hka:guard')
        const [call] = calls()
        assert.ok(call, 'the hook did not run in the skill’s turn')
        assert.equal(call.hook_event_name, 'PreToolUse')
        assert.equal(call.tool_name, 'Bash')
        assert.equal(call.tool_input?.command, 'echo HOOK-DURING')
        // components: the path variables are "also exported to hook, MCP, and LSP processes".
        assert.equal(env().trim(), record.dir)
      })
    },
  },
  {
    name: 'cc-skills: a skill hook with once: true is removed after its first successful run',
    async run(rt) {
      const onceOnly = async ({ session, calls }) => {
        await rt.say(session.id, '/hkc:guard')
        // A later turn's call: a hook without `once` keeps running there (the scenario below),
        // so this tells `once` apart from a hook that fires on the first call of each run.
        await bashTurn(rt, session, 'echo HOOK-LATER')
        // hooks: "`once` | If `true`, Claude Code removes the hook after its first successful
        // run ... Only honored for hooks declared in skill frontmatter".
        assert.deepEqual(
          calls().map((call) => call.tool_input?.command),
          ['echo HOOK-DURING'],
        )
      }
      await withHookSkill(rt, 'hkc', onceOnly, { once: true })
    },
  },
  {
    name: 'cc-skills: a skill’s frontmatter hooks keep running on later turns of the session',
    async run(rt) {
      await withHookSkill(rt, 'hkb', async ({ session, calls }) => {
        await rt.say(session.id, '/hkb:guard')
        await bashTurn(rt, session, 'echo HOOK-AFTER')
        // hooks: "keeps running them for the rest of the session, on turns after the skill's own
        // turn as well".
        assert.deepEqual(
          calls().map((call) => call.tool_input?.command),
          ['echo HOOK-DURING', 'echo HOOK-AFTER'],
        )
      })
    },
  },
  {
    name: 'cc-skills: a plugin command runs as /<plugin>:<command> with arguments, !`cmd`, model and its menu entry',
    async run(rt) {
      const about = md(
        ['description: CMD-DESC about', 'argument-hint: "[topic] [depth]"', 'model: gpt-4o-mini'],
        'CMD-BODY topic=$0 all=$ARGUMENTS root=${CLAUDE_PLUGIN_ROOT}\ndata: !`cat "${CLAUDE_PLUGIN_ROOT}/data.txt"`',
      )
      const files = {
        'commands/about.md': about,
        'commands/db/migrate.md': md(['description: Migrate'], 'CMD-MIGRATE $ARGUMENTS'),
        'data.txt': 'CMD-DATA',
      }
      await withPlugin(rt, 'cmd', files, async (record) => {
        const session = await rt.createSession({ title: 'Plugin command' })
        // components: "Save a command at `commands/<file>.md` and it becomes `/<plugin>:<file>`";
        // it "takes the same frontmatter as a skill".
        let after = await rt.say(session.id, '/cmd:about alpha deep')
        const text = lastInstruction(after)
        assert.ok(text.startsWith(`CMD-BODY topic=alpha all=alpha deep root=${record.dir}\n`), text)
        assert.ok(text.includes('data: CMD-DATA'), text)
        // skills: "`model` ... The override applies for the rest of the current turn ... The
        // session model resumes when you send your next prompt."
        assert.equal(lastRun(rt, after).model, 'gpt-4o-mini')
        after = await rt.say(session.id, 'Next.')
        assert.equal(lastRun(rt, after).model, 'gpt-4o')
        // components: "A subdirectory adds a segment, so `commands/db/migrate.md` is
        // `/my-plugin:db:migrate`".
        after = await rt.say(session.id, '/cmd:db:migrate up')
        assert.equal(lastInstruction(after), 'CMD-MIGRATE up')
        // skills: "`argument-hint` | Hint shown during autocomplete".
        const spec = (await commandSpecs(rt)).find((s) => s.fullName === 'cmd:about')
        assert.ok(spec?.description.includes('CMD-DESC about'), JSON.stringify(spec))
        assert.equal(spec.argumentHint, '[topic] [depth]')
      })
    },
  },
  {
    name: 'cc-skills: disabling the plugin removes its skills from /, the listing and the skill tool',
    async run(rt) {
      const body = md(['name: tip', 'description: OFF-DESC'], 'OFF-BODY')
      await withPlugin(rt, 'off', { 'skills/tip/SKILL.md': body }, async () => {
        const session = await rt.createSession({ title: 'Disabled plugin' })
        // While enabled, each of the three surfaces offers the skill, so their absence below is
        // the disable's doing.
        let after = await rt.say(session.id, '/off:tip')
        assert.equal(lastInstruction(after), 'OFF-BODY', 'the skill runs while enabled')
        after = await loadTurn(rt, session, 'off:tip')
        assert.ok(skillListing(lastRun(rt, after).system).includes('OFF-DESC'), 'not listed')
        assert.ok(resultOf(lastCall(after, 'skill')).includes('OFF-BODY'), 'not loadable')
        assert.ok(
          (await commandSpecs(rt)).some((s) => s.fullName === 'off:tip'),
          'not in /',
        )
        // skills: "Plugin skill: disable or uninstall the plugin that provides it ... Claude Code
        // unloads the plugin's skills when the change applies".
        after = await rt.say(session.id, '/plugin disable off')
        assert.match(replyOf(after), /Disabled `off`/)
        const ran = invocations(after).length
        after = await rt.say(session.id, '/off:tip')
        assert.equal(invocations(after).length, ran, 'the disabled skill still ran')
        const calls = toolItems(after, 'skill').length
        after = await loadTurn(rt, session, 'off:tip', 'Loaded again.')
        const listing = skillListing(lastRun(rt, after).system)
        assert.match(listing, /^- \//m, 'no skill listing was built')
        assert.ok(!listing.includes('OFF-DESC'), 'still listed')
        assert.equal(toolItems(after, 'skill').length, calls + 1, 'the skill tool was not called')
        assert.ok(!resultOf(lastCall(after, 'skill')).includes('OFF-BODY'), 'still loadable')
        assert.ok(!(await commandSpecs(rt)).some((s) => s.fullName === 'off:tip'), 'still in /')
      })
    },
  },
]
