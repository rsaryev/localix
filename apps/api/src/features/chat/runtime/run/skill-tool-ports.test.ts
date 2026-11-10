import { describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AgentTool } from '@localixai/agent/agents'
import { tempDirPerTest } from '@localixai/testing'

import type { PermissionRule } from '../../../agent-core/permission-engine'
import { verdictOf } from '../../../agent-core/permission-verdict'
import { createSkillTool } from '../../../agent-core/tools/skill'
import { createChatPluginSessions } from '../../../plugins/kit'
import { diskPluginHost } from '../../../plugins/kit/testing'
import type { SessionRecord } from '../../repository'
import { skillShellAnswer, skillToolPorts, type SkillCommandPolicyRef } from './skill-tool-ports'

/**
 * The model loading a skill must not get a shell the run's rules withhold. The defect: `get`
 * (classed a read, so plan mode let it through) ran the skill's injected commands with no
 * permission check at all. Claude Code checks each one first, and anything but `allow` aborts.
 */
const dir = tempDirPerTest('skill-tool-ports-')

// The shell tool's own verdict on a call: `git status` only reads, anything else reaches out.
const bash = {
  name: 'Bash',
  classify: (input: { command?: string }) => ({
    effect: input.command?.startsWith('git status') ? 'read' : 'external',
  }),
} as unknown as AgentTool
const tool = (name: string) =>
  ({ name, classify: () => ({ effect: 'external' }) }) as unknown as AgentTool

const PLAN: PermissionRule[] = [
  {
    permission: '*',
    pattern: 'effect:external',
    action: 'deny',
    message: 'Plan mode is read-only',
  },
]
const ASK_SHELL: PermissionRule[] = [{ permission: 'Bash', pattern: '*', action: 'ask' }]

const policy = (rules: PermissionRule[], tools = [bash]): SkillCommandPolicyRef => ({
  current: { rules, toolsByName: new Map(tools.map((t) => [t.name, t])), root: '/w' },
})

describe('a skill’s injected commands meet the run’s rules', () => {
  const answer = (ref: SkillCommandPolicyRef, command: string, grants: string[] = []) =>
    skillShellAnswer(ref)({ command, grants })

  test('a read-only mode refuses a command that reaches out, and lets a read run', () => {
    expect(answer(policy(PLAN), 'git status')).toBe('allow')
    expect(answer(policy(PLAN), 'touch x')).toBe('deny')
  })

  test('a command the rules would ask about is allowed only by the skill’s own grants', () => {
    expect(answer(policy(ASK_SHELL), 'git status')).toBe('ask')
    expect(answer(policy(ASK_SHELL), 'git status', ['Bash(git status)'])).toBe('allow')
  })

  test('nothing runs without the run’s rules or without a shell tool', () => {
    expect(answer({}, 'git status')).toBe('deny')
    expect(answer(policy([], []), 'git status')).toBe('deny')
  })
})

/** A skill folder in the chat's project, as the kit session finds it. */
function projectSkill(name: string, frontmatter: string, body: string): string {
  const at = join(dir(), 'work', '.claude', 'skills', name)
  mkdirSync(at, { recursive: true })
  const path = join(at, 'SKILL.md')
  writeFileSync(path, `---\nname: ${name}\ndescription: d\n${frontmatter}\n---\n${body}\n`)
  return path
}

function loadTool(_skill: string, commandPolicy: SkillCommandPolicyRef, latestUserText?: string) {
  mkdirSync(join(dir(), 'work', '.git'), { recursive: true })
  const kitSession = createChatPluginSessions(diskPluginHost(join(dir(), 'home'))).forRun({
    chatId: 's',
    cwd: join(dir(), 'work'),
    transcriptPath: join(dir(), 's.jsonl'),
    permissionMode: 'default',
    trusted: true,
    layers: [],
    plugins: [],
  })
  const ports = skillToolPorts({
    userId: 'u',
    session: { id: 's', agent: null } as unknown as SessionRecord,
    defaultCwd: join(dir(), 'work'),
    kitSession,
    commandPolicy,
    ...(latestUserText ? { latestUserText } : {}),
  })
  return createSkillTool(join(dir(), 'work'), {}, '', undefined, ports)
}

describe('the skill tool’s get runs the skill through the chat’s kit session', () => {
  test('a command the rules refuse refuses the load and runs nothing', async () => {
    const marker = join(dir(), 'ran')
    const skill = projectSkill('zz-ports-sneaky', '', `Run: !\`touch ${marker}\``)
    const got = await loadTool(skill, policy(PLAN)).execute('t', {
      action: 'get',
      name: 'zz-ports-sneaky',
    })
    expect(got.isError).toBe(true)
    expect(existsSync(marker)).toBe(false)
  })

  // skills.md, frontmatter `allowed-tools`: "Tools Claude can use without asking permission during
  // the turn that invokes this skill", and `disallowed-tools`: "Tools removed from Claude's
  // available pool while this skill is active". Both hold when Claude itself invokes the skill.
  test('allowed-tools are pre-approved and disallowed-tools refused for the rest of the run', async () => {
    const ASK: PermissionRule[] = [{ permission: '*', pattern: '*', action: 'ask' }]
    const commandPolicy = policy(ASK, ['Bash', 'Write', 'Read'].map(tool))
    const skill = projectSkill(
      'ship',
      'allowed-tools: Bash(git push *)\ndisallowed-tools: Write',
      'Ship $ARGUMENTS.',
    )
    const check = () => verdictOf(commandPolicy.current!)
    expect(check()('Bash', { command: 'git push origin' }).decision).toBe('ask')
    const got = await loadTool(skill, commandPolicy).execute('t', {
      action: 'get',
      name: 'ship',
      arguments: 'today',
    })
    expect(String(got.content)).toContain('Ship today.')
    expect(check()('Bash', { command: 'git push origin' }).decision).toBe('allow')
    expect(check()('Bash', { command: 'rm -rf x' }).decision).toBe('ask')
    expect(check()('Write', { path: 'a.txt', content: 'x' }).decision).toBe('deny')
  })

  // skills.md: a `/name` "after plain text, as a separate word with no punctuation attached"
  // permits the skill for that message, a `disable-model-invocation` one too.
  test('a disable-model-invocation skill is refused to the model unless the message names it', async () => {
    const skill = projectSkill('deploy', 'disable-model-invocation: true', 'Deploy.')
    const get = (text?: string) =>
      loadTool(skill, policy(PLAN), text).execute('t', { action: 'get', name: 'deploy' })
    expect((await get()).isError).toBe(true)
    expect((await get('see /deploy, then')).isError).toBe(true)
    const named = await get('go ahead and /deploy to staging')
    expect(named.isError).toBeUndefined()
    expect(String(named.content)).toContain('Deploy.')
  })

  // The kit's names: a plugin's skill is `<plugin>:<folder>`, whatever its frontmatter `name`.
  test('get finds a skill by the kit’s name and answers a miss with the names it has', async () => {
    const skill = projectSkill('zz-named', '', 'Named.')
    const tool = loadTool(skill, policy(PLAN))
    expect(
      String((await tool.execute('t', { action: 'get', name: '/zz-named' })).content),
    ).toContain('Named.')
    const miss = await tool.execute('t', { action: 'get', name: 'zz-nope' })
    expect(miss.isError).toBe(true)
    expect(String(miss.content)).toContain('Available skills: zz-named')
  })
})

describe('a skill the agent saves is the one it loads', () => {
  test('save writes the project skill, and the next get finds it through the session', async () => {
    const skills = loadTool('', policy([]))
    const saved = await skills.execute('t1', {
      action: 'save',
      name: 'zz-ports-saved',
      description: 'Saved',
      content: 'STEP ONE marker',
      scope: 'project',
    })
    expect(saved.content).toContain('(project)')
    const got = await skills.execute('t2', { action: 'get', name: 'zz-ports-saved' })
    expect(got.content).toContain('# Skill: zz-ports-saved')
    expect(got.content).toContain(
      JSON.stringify(join(dir(), 'work', '.claude', 'skills', 'zz-ports-saved')),
    )
    expect(got.content).toContain('STEP ONE marker')
  })
})
