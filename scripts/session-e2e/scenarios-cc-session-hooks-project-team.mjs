/** Session E2E: Claude Code session hooks — project files, settings, tasks, teammates and MessageDisplay. */
import assert from 'node:assert/strict'
import { existsSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

// The host's own name for the task board tool, so the scenario follows it if it moves.
import { TASK_BOARD_TOOL } from '../../apps/api/src/features/cc-hooks/task-events.ts'

import { runs, script } from './scenario-helpers.mjs'
import { until, writeTree } from './scenarios-cc-helpers.mjs'
import { chat, hookPlugin, reads, withProject } from './scenarios-cc-session-hooks-helpers.mjs'

export const CC_SESSION_HOOK_PROJECT_TEAM_SCENARIOS = [
  {
    name: 'cc-session-hooks: in a project, CLAUDE.md fires InstructionsLoaded, a watched file fires FileChanged, and a move fires CwdChanged',
    async run(rt) {
      // FileChanged: "the value is split on | and each segment is registered as a literal
      // filename in the working directory".
      const p = hookPlugin(rt, 'ccs-project')
        .on('InstructionsLoaded', 'instr')
        .on('FileChanged', 'file', '', { matcher: 'ccs-watched.txt' })
        .on('CwdChanged', 'cwd')
      await p.run(() =>
        withProject(rt, 'CC session hooks', async (project, dir) => {
          writeFileSync(path.join(dir, 'CLAUDE.md'), '# Rules\n\nCCS-PROJECT-RULE\n')
          const session = await rt.createSession({ title: 'Project', projectId: project.id })
          await rt.say(session.id, `Hi. ${script({ localix: ['Hello.'] })}`)
          // InstructionsLoaded: "file_path | Absolute path to the instruction file", memory_type
          // "Project", load_reason "session_start".
          const loaded = await until(
            () => p.seen('instr').find((i) => i.file_path?.endsWith('CLAUDE.md')),
            'InstructionsLoaded named CLAUDE.md',
          )
          assert.equal(loaded.file_path, path.join(dir, 'CLAUDE.md'))
          assert.equal(loaded.memory_type, 'Project')
          assert.equal(loaded.load_reason, 'session_start')
          // FileChanged: "file_path | Absolute path to the file that changed"; event "add" for a
          // created file, "change" for a modified one.
          const watched = path.join(dir, 'ccs-watched.txt')
          writeFileSync(watched, 'one\n')
          const added = await until(() => p.seen('file')[0], 'FileChanged ran on add')
          assert.deepEqual([added.file_path, added.event], [watched, 'add'])
          // Rewritten on every poll: a watcher that re-arms after the add can miss a single write.
          let edits = 0
          const changed = await until(() => {
            writeFileSync(watched, `edit ${++edits}\n`)
            return p.seen('file').find((i) => i.event === 'change')
          }, 'a change event')
          assert.equal(changed.file_path, watched)
          // CwdChanged "receive old_cwd and new_cwd".
          await withProject(rt, 'CC session hooks 2', async (other, otherDir) => {
            await rt.api(`/sessions/${session.id}`, { projectId: other.id }, 'PATCH')
            const moved = await until(() => p.seen('cwd')[0], 'CwdChanged ran')
            assert.deepEqual([moved.old_cwd, moved.new_cwd], [dir, otherDir])
          })
        }),
      )
    },
  },
  {
    name: 'cc-session-hooks: InstructionsLoaded does not fire for an AGENTS.md read directly',
    async run(rt) {
      const p = hookPlugin(rt, 'ccs-agents-md').on('InstructionsLoaded', 'instr')
      await p.run(() =>
        withProject(rt, 'CC instructions', async (project, dir) => {
          writeTree(dir, { 'AGENTS.md': '# Agents\n\nCCS-AGENTS-RULE\n' })
          const direct = await rt.createSession({ title: 'AGENTS.md', projectId: project.id })
          await rt.say(direct.id, `Hi. ${script({ localix: ['Hello.'] })}`)
          const [first] = runs(rt, direct, 'localix')
          assert.ok(first, 'the turn reached the model')
          // A later session loads a CLAUDE.md, which does fire: once its input lands, any input
          // from the earlier session, fired first, has landed too.
          rmSync(path.join(dir, 'AGENTS.md'))
          writeTree(dir, { 'CLAUDE.md': '# Claude\n' })
          const control = await rt.createSession({ title: 'CLAUDE.md', projectId: project.id })
          await rt.say(control.id, `Hi. ${script({ localix: ['Hello.'] })}`)
          await until(
            () => p.seen('instr').some((input) => input.file_path?.endsWith('CLAUDE.md')),
            'InstructionsLoaded ran for CLAUDE.md',
          )
          // "This event doesn't fire when Claude reads AGENTS.md directly".
          const files = p.seen('instr').map((input) => path.basename(input.file_path))
          assert.ok(!files.includes('AGENTS.md'), files.join())
        }),
      )
    },
  },
  {
    name: 'cc-session-hooks: hooks in a project .claude/settings.json do not run',
    async run(rt) {
      await withProject(rt, 'CC settings hooks', async (project, dir) => {
        const marker = path.join(dir, 'settings-hook-ran')
        const command = `touch "${marker}"; echo SETTINGS-HOOK-CONTEXT`
        const settings = {
          hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command }] }] },
        }
        writeTree(dir, { '.claude/settings.json': JSON.stringify(settings) })
        const session = await rt.createSession({ title: 'Settings hooks', projectId: project.id })
        await rt.say(session.id, `Hi. ${script({ localix: ['Hello.'] })}`)
        // A deliberate difference from Claude Code, docs/features/hooks-and-commands.md (Limits):
        // "Localix does not load hooks from ambient user, project, or local settings files." A
        // UserPromptSubmit hook runs before the model is asked, so the request is the evidence.
        const [first] = runs(rt, session, 'localix')
        assert.ok(first, 'the turn reached the model')
        assert.ok(!reads(first).includes('SETTINGS-HOOK-CONTEXT'), reads(first))
        assert.ok(!existsSync(marker), 'the settings hook ran')
      })
    },
  },
  {
    name: 'cc-session-hooks: TaskCreated exit 2 rolls the card back with the reason, and TaskCompleted exit 2 keeps it open',
    async run(rt) {
      const p = hookPlugin(rt, 'ccs-task')
        .on(
          'TaskCreated',
          'created',
          `case "$input" in *BAD-SUBJECT*) echo 'NEEDS-TICKET' >&2; exit 2 ;; esac`,
        )
        .on('TaskCompleted', 'completed', `echo 'TESTS-FAILING' >&2\nexit 2`)
      await p.run(async () => {
        const board = (args) => ({ tool: TASK_BOARD_TOOL, args })
        const create = (title) => board({ action: 'create', title })
        // The board tool waits behind activation, as a real model finds it.
        const activate = { tool: 'activate_tools', args: { names: [TASK_BOARD_TOOL] } }
        const steps = [activate, create('BAD-SUBJECT task'), create('[T-1] Good task'), 'Made.']
        const session = await chat(rt, 'Tasks', [`Plan. ${script({ localix: steps })}`])
        // TaskCreated input: "task_id, task_subject"; exit 2: "Claude Code deletes the task and
        // returns your message to Claude as the tool's error".
        const [bad, good] = p.seen('created')
        assert.equal(bad.task_subject, 'BAD-SUBJECT task')
        assert.ok(bad.task_id)
        const afterBad = runs(rt, session, 'localix')[2]
        assert.ok(reads(afterBad).includes('NEEDS-TICKET'), reads(afterBad))
        const done = [
          board({ action: 'complete', task_id: good.task_id }),
          board({ action: 'list' }),
          'Ok.',
        ]
        await rt.say(session.id, `Close it. ${script({ localix: done })}`)
        // TaskCompleted: "the task is not marked as completed and the stderr message is fed back
        // to the model as feedback".
        const [completed] = p.seen('completed')
        assert.deepEqual(
          [completed.task_id, completed.task_subject],
          [good.task_id, '[T-1] Good task'],
        )
        const later = runs(rt, session, 'localix')
        assert.ok(reads(later.at(-2)).includes('TESTS-FAILING'), reads(later.at(-2)))
        // The board holds the good card, still open, and not the refused one.
        const listed = reads(later.at(-1))
        assert.ok(listed.includes(`[backlog] ${good.task_id} — [T-1] Good task`), listed)
        assert.ok(!listed.includes(`${bad.task_id} —`), listed)
      })
    },
  },
  {
    name: 'cc-session-hooks: TeammateIdle reads the teammate name, and exit 2 keeps the teammate working',
    async run(rt) {
      const once = `[ -f "$OUT/flag" ] && exit 0\ntouch "$OUT/flag"\necho 'IDLE-RUN-LINT' >&2\nexit 2`
      const p = hookPlugin(rt, 'ccs-idle').on('TeammateIdle', 'idle', once)
      // Installing enables a plugin for the default agent only: the teammate is granted it too.
      const grant = (effect) =>
        rt.api('/capabilities/rules/apply', {
          agentId: rt.agentIds.checker,
          changes: [{ action: 'plugin:ccs-idle', resource: '*', effect }],
        })
      await p.run(async () => {
        await grant('allow')
        try {
          const session = await rt.createSession({ title: 'Idle', handles: ['localix', 'checker'] })
          const steps = { localix: ['@checker, verify it.'], checker: ['Verified.', 'Lint clean.'] }
          await rt.say(session.id, `Ship. ${script(steps)}`, { timeoutMs: 90_000 })
          // "TeammateIdle hooks receive teammate_name and team_name"; exit 2: "the teammate
          // receives the stderr message as feedback and continues working".
          const [first] = p.seen('idle')
          assert.equal(first?.hook_event_name, 'TeammateIdle')
          assert.equal(first.teammate_name, 'checker')
          const [, again] = runs(rt, session, 'checker')
          assert.ok(again && reads(again).includes('IDLE-RUN-LINT'), 'the teammate went idle')
        } finally {
          await grant('default')
        }
      })
    },
  },
  {
    name: 'cc-session-hooks: MessageDisplay reads the whole message once, with index 0 and final true',
    async run(rt) {
      const p = hookPlugin(rt, 'ccs-display').on('MessageDisplay', 'display')
      await p.run(async () => {
        await chat(rt, 'Display input', [`Talk. ${script({ localix: ['Line one.\nLine two.'] })}`])
        // "In non-interactive runs … MessageDisplay runs once per assistant message … index is 0,
        // final is true, and delta holds the entire message."
        const inputs = p.seen('display')
        assert.equal(inputs.length, 1, JSON.stringify(inputs))
        const [{ index, final, delta, turn_id, message_id }] = inputs
        assert.deepEqual([index, final, delta], [0, true, 'Line one.\nLine two.'])
        assert.ok(turn_id && message_id)
      })
    },
  },
]
