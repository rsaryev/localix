/** Session E2E: Claude Code plugin skills — names, arguments, rendering and the model’s view. */
import assert from 'node:assert/strict'
import path from 'node:path'

import { lastRun, runs } from './scenario-helpers.mjs'
import { md } from './scenarios-cc-helpers.mjs'
import {
  commandSpecs,
  lastCall,
  lastInstruction,
  loadTurn,
  resultOf,
  skillListing,
  toolResults,
  withPlugin,
} from './scenarios-cc-skills-helpers.mjs'

export const CC_SKILL_INVOCATION_SCENARIOS = [
  {
    name: 'cc-skills: /<plugin>:<skill> runs by frontmatter name or folder, bare too, with its arguments substituted',
    async run(rt) {
      const salute = md(
        [
          'name: salute',
          'description: Greets someone',
          'arguments: [who, where]',
          'argument-hint: "[who] [where]"',
        ],
        'NM-BODY who=$who where=$where all=$ARGUMENTS zero=$0 one=$1 idx=$ARGUMENTS[1] price=\\$1.00',
      )
      await withPlugin(
        rt,
        'nmx',
        {
          'skills/greet/SKILL.md': salute,
          'skills/plain-dir/SKILL.md': md(['description: No name'], 'NM-PLAIN $ARGUMENTS'),
          'skills/pre/SKILL.md': md(['name: nmx:prefixed', 'description: P'], 'NM-PREFIXED'),
        },
        async () => {
          const session = await rt.createSession({ title: 'Skill names' })
          // skills: "Plugin `skills/` subdirectory | Frontmatter `name` or the directory name,
          // namespaced by plugin | ... `/my-plugin:fancy` with `name: fancy`".
          let after = await rt.say(session.id, '/nmx:salute "Ada Lovelace" London')
          // skills: `/my-skill "hello world" second` "makes `$0` expand to `hello world`"; "The
          // `$ARGUMENTS` placeholder always expands to the full argument string as typed"; "with
          // `arguments: [issue, branch]` the placeholder `$issue` expands to the first argument";
          // "escape it with a backslash: `\$1.00`".
          assert.equal(
            lastInstruction(after),
            'NM-BODY who=Ada Lovelace where=London all="Ada Lovelace" London zero=Ada Lovelace one=London idx=London price=$1.00',
          )
          assert.ok(
            lastRun(rt, after).messages.some((m) => m.text.includes('NM-BODY who=Ada Lovelace')),
            'the model read the rendered skill',
          )
          // skills: "The bare `/fancy` also invokes the skill unless another command already uses
          // that name"; "A named placeholder ... with no matching argument expands to an empty
          // string"; an argument value containing `$1` is inserted "as literal text".
          after = await rt.say(session.id, '/salute "$1 later"')
          assert.match(lastInstruction(after), /^NM-BODY who=\$1 later where= all="\$1 later"/)
          // components: "Command name: `/<plugin>:<directory>`".
          after = await rt.say(session.id, '/nmx:plain-dir x')
          assert.equal(lastInstruction(after), 'NM-PLAIN x')
          // skills: "If the `name` you write already starts with the plugin's own prefix, Claude
          // Code doesn't add the prefix again".
          after = await rt.say(session.id, '/nmx:prefixed')
          assert.equal(lastInstruction(after), 'NM-PREFIXED')
          // skills: "`argument-hint` | Hint shown during autocomplete".
          const spec = (await commandSpecs(rt)).find((s) => s.fullName === 'nmx:salute')
          assert.equal(spec?.argumentHint, '[who] [where]', JSON.stringify(spec))
        },
      )
    },
  },
  {
    name: 'cc-skills: a missing indexed argument stays literal, and unplaced arguments append as "ARGUMENTS: <value>"',
    async run(rt) {
      await withPlugin(
        rt,
        'arg',
        {
          'skills/ix/SKILL.md': md(['description: I'], 'IDX first=$0 third=$2 sixth=$ARGUMENTS[5]'),
          'skills/bare/SKILL.md': md(['description: B'], 'APP-BARE'),
          'skills/dir/SKILL.md': md(['description: D'], 'APP-DIR ${CLAUDE_SKILL_DIR}'),
        },
        async () => {
          const session = await rt.createSession({ title: 'Argument edges' })
          const ix = lastInstruction(await rt.say(session.id, '/arg:ix only'))
          const bare = lastInstruction(await rt.say(session.id, '/arg:bare one two'))
          const dir = lastInstruction(await rt.say(session.id, '/arg:dir one two'))
          const seen = JSON.stringify({ ix, bare, dir })
          // skills: "An indexed placeholder with no corresponding argument, such as `$2` when only
          // one argument was passed, stays in the content unchanged."
          assert.equal(ix, 'IDX first=only third=$2 sixth=$ARGUMENTS[5]', seen)
          // skills: "When no placeholder receives an argument, Claude Code appends them as
          // `ARGUMENTS: <value>`"; a placeholder is "`$ARGUMENTS`, an indexed form ... or a named
          // argument".
          assert.match(bare, /^APP-BARE\s+ARGUMENTS: one two$/, seen)
          assert.match(dir, /ARGUMENTS: one two$/, seen)
        },
      )
    },
  },
  {
    name: 'cc-skills: ${CLAUDE_SKILL_DIR}, ${CLAUDE_PLUGIN_ROOT}, ${CLAUDE_SESSION_ID} and !`cmd` render before the model reads the skill',
    async run(rt) {
      const body = [
        'INJ-BODY',
        'data: !`cat "${CLAUDE_SKILL_DIR}/data.txt"`',
        'shared: !`cat "${CLAUDE_PLUGIN_ROOT}/shared.txt"`',
        'cwd: !`basename "$PWD"`',
        '```!',
        'echo BLOCK-$((2 + 3))',
        '```',
        'KEY=!`echo NOT-RUN`',
        'dir=${CLAUDE_SKILL_DIR}',
        'root=${CLAUDE_PLUGIN_ROOT}',
        'sid=${CLAUDE_SESSION_ID}',
      ].join('\n')
      await withPlugin(
        rt,
        'inj',
        {
          'skills/ctx/SKILL.md': md(['description: Injects'], body),
          'skills/ctx/data.txt': 'SKILL-DATA',
          'shared.txt': 'PLUGIN-SHARED',
        },
        async (record) => {
          const session = await rt.createSession({ title: 'Skill injection' })
          const text = lastInstruction(await rt.say(session.id, '/inj:ctx'))
          // skills: "`${CLAUDE_SKILL_DIR}` ... For plugin skills, this is the skill's subdirectory
          // within the plugin"; "`${CLAUDE_PLUGIN_ROOT}` | The plugin's installation directory";
          // "`${CLAUDE_SESSION_ID}` | The current session ID".
          assert.ok(text.includes(`dir=${path.join(record.dir, 'skills', 'ctx')}\n`), text)
          assert.ok(text.includes(`root=${record.dir}\n`), text)
          assert.ok(!text.includes('${CLAUDE_SESSION_ID}') && /sid=\S+/.test(text), text)
          // skills: "The `` !`<command>` `` syntax runs shell commands before the skill content is
          // sent to Claude"; "For multi-line commands, use a fenced code block opened with
          // ` ```! `"; "Claude Code runs each command in the session shell's current working
          // directory".
          assert.ok(text.includes('data: SKILL-DATA'), text)
          assert.ok(text.includes('shared: PLUGIN-SHARED'), text)
          assert.ok(text.includes(`cwd: LOCALIX-${session.seq}`), text)
          assert.ok(text.includes('BLOCK-5') && !text.includes('```!'), text)
          // skills: "If `!` follows another character, as in `` KEY=!`cmd` ``, the placeholder is
          // left as literal text and the command does not run."
          assert.ok(text.includes('KEY=!`echo NOT-RUN`'), text)
        },
      )
    },
  },
  {
    name: 'cc-skills: an injected command merges its stderr, and a failing one aborts the invocation',
    async run(rt) {
      await withPlugin(
        rt,
        'sht',
        {
          'skills/err/SKILL.md': md(['description: E'], 'ERR out: !`echo ERR-OUT; echo ERR-2 >&2`'),
          'skills/fail/SKILL.md': md(['description: F'], 'ABORT-BODY\n!`echo partial; exit 3`'),
        },
        async () => {
          const session = await rt.createSession({ title: 'Injected command output' })
          const err = lastInstruction(await rt.say(session.id, '/sht:err'))
          const after = await rt.say(session.id, '/sht:fail')
          const read = runs(rt, after, 'localix').flatMap((r) => r.messages.map((m) => m.text))
          const aborted = read.filter((text) => text.includes('ABORT-BODY'))
          const seen = JSON.stringify({ err, aborted })
          // skills: "with the default `bash` shell, Claude Code merges stderr into stdout.
          // Anything the command writes to stderr appears in the injected text."
          assert.ok(err.includes('ERR-OUT') && err.includes('ERR-2'), seen)
          // skills: "A failed command aborts the entire skill invocation ... Claude never sees the
          // skill content for that invocation."
          assert.equal(aborted.length, 0, seen)
        },
      )
    },
  },
  {
    name: 'cc-skills: the model sees a plugin skill’s description and loads its body through the skill tool',
    async run(rt) {
      const body = md(['name: lookup', 'description: LIST-DESC finds things'], 'LOAD-BODY steps')
      await withPlugin(rt, 'lst', { 'skills/finder/SKILL.md': body }, async () => {
        const session = await rt.createSession({ title: 'Model loads a skill' })
        const after = await loadTurn(rt, session, 'lst:lookup')
        // skills: "(default) | ... | Description always in context, full skill loads when
        // invoked".
        const [first] = runs(rt, after, 'localix')
        assert.ok(first.tools.includes('skill'), 'the skill tool is on the roster')
        assert.ok(skillListing(first.system).includes('LIST-DESC finds things'))
        assert.ok(!first.system.includes('LOAD-BODY'), 'the body loads only when invoked')
        assert.ok(toolResults(after, 'skill').at(-1)?.includes('LOAD-BODY steps'))
      })
    },
  },
  {
    name: 'cc-skills: the model’s view of a plugin skill: listed as /<plugin>:<skill>, loaded rendered',
    async run(rt) {
      const body = md(
        ['name: lookup', 'description: NSL-DESC'],
        'NSL dir=${CLAUDE_SKILL_DIR}\nout: !`echo NSL-RAN`',
      )
      await withPlugin(rt, 'nsl', { 'skills/finder/SKILL.md': body }, async (record) => {
        const session = await rt.createSession({ title: 'Model view' })
        const after = await loadTurn(rt, session, 'nsl:lookup')
        const line = skillListing(lastRun(rt, after).system)
          .split('\n')
          .find((l) => l.includes('NSL-DESC'))
        const result = resultOf(lastCall(after, 'skill'))
        const seen = JSON.stringify({ line, result })
        // skills: "Plugin | `<plugin>/skills/<skill-name>/SKILL.md` | Wherever the plugin is
        // enabled, as `/plugin-name:skill-name`".
        assert.match(line ?? '', /nsl:lookup/, seen)
        // skills: "When you or Claude invoke a skill, the rendered `SKILL.md` content enters the
        // conversation"; `${CLAUDE_SKILL_DIR}` is substituted in "the skill's markdown content".
        assert.ok(result.includes(`dir=${path.join(record.dir, 'skills', 'finder')}`), seen)
        assert.ok(result.includes('out: NSL-RAN'), seen)
      })
    },
  },
]
