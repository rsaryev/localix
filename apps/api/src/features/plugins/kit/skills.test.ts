import { describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'
import { createLocalixPluginHost } from './host'
import { createChatPluginSessions } from './sessions'
import { invokeSkill, invokeTypedSkills } from './skills'

const dir = tempDirPerTest('kit-skills')

function skill(name: string, frontmatter: string, body: string): string {
  const at = join(dir(), 'work', '.claude', 'skills', name)
  mkdirSync(at, { recursive: true })
  writeFileSync(join(at, 'SKILL.md'), `---\nname: ${name}\n${frontmatter}\n---\n${body}\n`)
  return at
}

function session() {
  mkdirSync(join(dir(), 'work', '.git'), { recursive: true })
  const host = createLocalixPluginHost({
    homeDir: join(dir(), 'home'),
    environment: () => ({ PATH: process.env.PATH }),
    pluginsRoot: () => join(dir(), 'plugins'),
    scratchDir: () => join(dir(), 'scratch'),
    envFilesDir: (sessionId) => join(dir(), 'sessions', sessionId),
    managedDirectory: undefined,
    mcp: () => undefined,
    models: () => undefined,
  })
  return createChatPluginSessions(host).forRun({
    chatId: 'chat-1',
    cwd: join(dir(), 'work'),
    transcriptPath: join(dir(), 'chat-1.jsonl'),
    permissionMode: 'default',
    trusted: true,
    layers: [],
    plugins: [],
  })
}

const signal = new AbortController().signal

describe('a skill invoked through the chat kit session', () => {
  test('expands its arguments and skill folder, and carries its grants and model', async () => {
    const at = skill(
      'greet',
      'description: Greets\nallowed-tools: Bash(echo *)\ndisallowed-tools: Write\nmodel: sonnet',
      'Hello $ARGUMENTS from ${CLAUDE_SKILL_DIR}',
    )
    const invoked = await invokeSkill(session(), 'greet', {
      arguments: 'world',
      invoker: 'model',
      signal,
    })
    if (!invoked.ok) throw new Error(invoked.message)
    expect(invoked.skill.text).toContain(`Hello world from ${at}`)
    expect(invoked.skill.grants).toEqual(['Bash(echo *)'])
    expect(invoked.skill.disallowed).toEqual(['Write'])
    expect(invoked.skill.model).toBe('sonnet')
    expect(invoked.skill.fork).toBeUndefined()
  })

  test('a context: fork skill runs in the subagent it names', async () => {
    skill('explore', 'description: Explores\ncontext: fork\nagent: Explore', 'Look around')
    const invoked = await invokeSkill(session(), 'explore', { invoker: 'user', signal })
    if (!invoked.ok) throw new Error(invoked.message)
    expect(invoked.skill.fork).toEqual({ agent: 'Explore', wait: false })
  })

  test("a `!` command runs only with the host's answer", async () => {
    skill('status', 'description: Status', 'Now: !`echo ran-it`')
    const chat = session()
    const denied = await invokeSkill(chat, 'status', {
      invoker: 'model',
      signal,
      shellPermission: () => 'deny',
    })
    expect(denied.ok).toBe(false)
    const allowed = await invokeSkill(chat, 'status', {
      invoker: 'model',
      signal,
      shellPermission: ({ command }) => (command === 'echo ran-it' ? 'allow' : 'deny'),
    })
    if (!allowed.ok) throw new Error(allowed.message)
    expect(allowed.skill.text).toContain('ran-it')
  })

  test('an argument reaches a `!` command as data, in every quoting', async () => {
    skill('say', 'description: Say', 'Said: !`printf "[%s]" $ARGUMENTS "$1" \'$0\'`')
    const asked: string[] = []
    const invoked = await invokeSkill(session(), 'say', {
      invoker: 'model',
      arguments: `"a; touch PWNED" '$(touch PWNED2)'`,
      signal,
      shellPermission: ({ command }) => (asked.push(command), 'allow'),
    })
    if (!invoked.ok) throw new Error(invoked.message)
    expect(invoked.skill.text).toEndWith(
      'Said: [a; touch PWNED][$(touch PWNED2)][$(touch PWNED2)][a; touch PWNED]\n',
    )
    expect(existsSync(join(dir(), 'work', 'PWNED'))).toBe(false)
    expect(existsSync(join(dir(), 'work', 'PWNED2'))).toBe(false)
    // The rules read the command that runs, each value quoted.
    expect(asked).toEqual([
      `printf "[%s]" 'a; touch PWNED' '$(touch PWNED2)' "\\$(touch PWNED2)" 'a; touch PWNED'`,
    ])
  })

  test('an unknown skill is a refusal with its reason', async () => {
    const invoked = await invokeSkill(session(), 'nope', { invoker: 'user', signal })
    expect(invoked).toEqual({ ok: false, message: expect.stringContaining('nope') })
  })
})

describe('a message the person types', () => {
  test('expands the leading skill and the ones stacked after it, each with the arguments', async () => {
    skill('write-tests', 'description: Tests', 'Tests for $ARGUMENTS')
    skill('fix-issue', 'description: Fix', 'Fix issue $ARGUMENTS')
    const typed = await invokeTypedSkills(session(), '/write-tests /fix-issue 123', { signal })
    if (!typed.ok) throw new Error(typed.message)
    // Claude Code leads each with "Base directory for this skill: <dir>".
    expect(
      typed.skills.map(({ command, text }) => [command, text.trim().split('\n').pop()]),
    ).toEqual([
      ['write-tests', 'Tests for 123'],
      ['fix-issue', 'Fix issue 123'],
    ])
  })

  test('a message no skill leads expands nothing', async () => {
    const typed = await invokeTypedSkills(session(), '/compact now', { signal })
    expect(typed).toEqual({ ok: true, skills: [] })
  })
})
