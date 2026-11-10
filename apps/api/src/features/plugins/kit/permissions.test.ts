import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SettingsRuleEntry } from './settings/permissions'
import {
  settingsDeniesAgent,
  settingsRemovesTool,
  settingsResolvedPaths,
  settingsRules,
  settingsVerdict,
  withRealDirectories,
  withSessionRules,
} from './permissions'

const FILE = '/work/app/.claude/settings.json'
const entry = (effect: SettingsRuleEntry['effect'], raw: string): SettingsRuleEntry => ({
  effect,
  raw,
  file: FILE,
  sourceDir: '/work/app',
  scope: 'project',
})
const rulesOf = (...entries: SettingsRuleEntry[]) =>
  settingsRules(entries, { cwd: '/work/app', homeDir: '/home/me', additionalDirectories: [] })

describe("Claude Code's permission rules at a Localix call", () => {
  test('a deny rule refuses a shell line any of whose commands it covers, naming rule and file', () => {
    const rules = rulesOf(entry('deny', 'Bash(rm *)'))
    expect(settingsVerdict(rules, { name: 'Bash' }, { command: 'ls && rm -rf build' })).toEqual({
      effect: 'deny',
      rule: 'Bash(rm *)',
      where: FILE,
    })
    expect(settingsVerdict(rules, { name: 'Bash' }, { command: 'ls' })).toBeUndefined()
  })

  test('a deny beats an ask whatever their order', () => {
    const rules = rulesOf(entry('ask', 'Bash'), entry('deny', 'Bash(git push *)'))
    expect(settingsVerdict(rules, { name: 'Bash' }, { command: 'git push' })?.effect).toBe('deny')
    expect(settingsVerdict(rules, { name: 'Bash' }, { command: 'git status' })?.effect).toBe('ask')
  })

  test('an allow covers a shell line only when it covers every command of it', () => {
    const rules = rulesOf(entry('allow', 'Bash(git *)'))
    const run = (command: string) => settingsVerdict(rules, { name: 'Bash' }, { command })
    expect(run('git status && git diff')).toEqual({
      effect: 'allow',
      rule: 'Bash(git *)',
      where: FILE,
    })
    expect(run('git status && rm -rf build')).toBeUndefined()
  })

  test("an allow is the call's own: a file the line names, with no rule of its own, does not undo it", () => {
    const rules = rulesOf(entry('allow', 'Bash(cat *)'))
    expect(settingsVerdict(rules, { name: 'Bash' }, { command: 'cat README.md' })?.effect).toBe(
      'allow',
    )
    const guarded = rulesOf(entry('allow', 'Bash(cat *)'), entry('ask', 'Read(./.env)'))
    expect(settingsVerdict(guarded, { name: 'Bash' }, { command: 'cat .env' })?.effect).toBe('ask')
  })

  test("a path rule reads Localix's file tools under Claude Code's names, anchored at the project", () => {
    const rules = rulesOf(entry('ask', 'Edit(/src/**)'))
    const write = { files: [{ path: 'src/a.ts', content: 'x' }] }
    expect(settingsVerdict(rules, { name: 'Write' }, write)?.effect).toBe('ask')
    const elsewhere = { files: [{ path: 'docs/a.md', content: 'x' }] }
    expect(settingsVerdict(rules, { name: 'Write' }, elsewhere)).toBeUndefined()
  })

  test('a Read deny guards the files a shell line names', () => {
    const rules = rulesOf(entry('deny', 'Read(./.env)'))
    expect(settingsVerdict(rules, { name: 'Bash' }, { command: 'cat .env' })?.effect).toBe('deny')
    expect(settingsVerdict(rules, { name: 'Bash' }, { command: 'cat README.md' })).toBeUndefined()
  })

  test('an MCP rule matches the tool by its Claude Code name', () => {
    const rules = rulesOf(entry('deny', 'mcp__github'))
    const tool = { name: 'github_issue', aliases: ['mcp__github__issue'] }
    expect(settingsVerdict(rules, tool, {})?.effect).toBe('deny')
  })

  test('a bare deny takes a tool away only when it removes every Claude Code name the tool has', () => {
    expect(settingsRemovesTool(rulesOf(entry('deny', 'Write')), { name: 'Write' })).toBe(true)
    expect(settingsRemovesTool(rulesOf(entry('deny', 'Bash(rm *)')), { name: 'Bash' })).toBe(false)
    // Localix's Research both searches and fetches: one of the two denied leaves it in place.
    expect(settingsRemovesTool(rulesOf(entry('deny', 'WebFetch')), { name: 'Research' })).toBe(
      false,
    )
    const both = rulesOf(entry('deny', 'WebFetch'), entry('deny', 'WebSearch'))
    expect(settingsRemovesTool(both, { name: 'Research' })).toBe(true)
    const mcp = { name: 'github_issue', aliases: ['mcp__github__issue'] }
    expect(settingsRemovesTool(rulesOf(entry('deny', 'mcp__*')), mcp)).toBe(true)
  })

  test('an Agent deny names the subagent types it keeps from the model', () => {
    const rules = rulesOf(entry('deny', 'Agent(Explore)'))
    expect(settingsDeniesAgent(rules, 'Explore')).toBe(true)
    expect(settingsDeniesAgent(rules, 'worker')).toBe(false)
  })

  test('a bare deny of a Localix tool by its own name takes it away', () => {
    const rules = rulesOf(entry('deny', 'Configure'))
    expect(settingsRemovesTool(rules, { name: 'Configure' })).toBe(true)
    expect(settingsRemovesTool(rules, { name: 'Store' })).toBe(false)
  })

  test("a WebFetch domain rule judges the pages Localix's Research reads", () => {
    const rules = rulesOf(entry('deny', 'WebFetch(domain:*.evil.example)'))
    const fetch = (url: string) => settingsVerdict(rules, { name: 'Research' }, { urls: [url] })
    expect(fetch('https://a.b.evil.example/x')?.effect).toBe('deny')
    expect(fetch('https://example.com/')).toBeUndefined()
  })

  test('an Agent call with no type runs general-purpose, which a deny of it refuses', () => {
    const rules = rulesOf(entry('deny', 'Agent(general-purpose)'))
    const call = { description: 't', prompt: 'x' }
    expect(settingsVerdict(rules, { name: 'Agent' }, call)?.effect).toBe('deny')
    const typed = { ...call, subagent_type: 'reviewer' }
    expect(settingsVerdict(rules, { name: 'Agent' }, typed)).toBeUndefined()
  })

  test("a run's own rules read as session rules beside the settings, with their own refusal", () => {
    const base = rulesOf(entry('ask', 'Bash(git push *)'))
    const skill = withSessionRules(base, {
      rules: ['Bash(git *)', 'Read(/docs/**)'],
      behavior: 'allow',
      where: "the skill's allowed-tools",
    })
    const run = (command: string) => settingsVerdict(skill, { name: 'Bash' }, { command })
    expect(run('git status')).toEqual({
      effect: 'allow',
      rule: 'Bash(git *)',
      where: "the skill's allowed-tools",
    })
    // An ask in the settings still asks: allowed-tools never loosen a deny or an ask.
    expect(run('git push')?.effect).toBe('ask')
    expect(settingsVerdict(skill, { name: 'Read' }, { path: 'docs/a.md' })?.effect).toBe('allow')
    const denied = withSessionRules(base, {
      rules: ['Bash(rm *)'],
      behavior: 'deny',
      where: 'disallowed-tools',
      message: 'Removed by the skill.',
    })
    expect(settingsVerdict(denied, { name: 'Bash' }, { command: 'rm -rf x' })).toMatchObject({
      effect: 'deny',
      message: 'Removed by the skill.',
    })
    expect(base.rules).toHaveLength(1)
  })

  test('a rule Claude Code skips is no rule', () => {
    const rules = rulesOf(entry('deny', 'mcp__github(issue)'))
    expect(rules.rules).toEqual([])
  })
})

describe('a path rule sees where a symlink leads', () => {
  const tree = () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'llx-links-')))
    mkdirSync(join(root, 'proj'))
    mkdirSync(join(root, 'secret'))
    writeFileSync(join(root, 'secret', 'key'), 'k')
    return root
  }
  const at = (root: string, ...entries: SettingsRuleEntry[]) =>
    settingsRules(entries, {
      cwd: join(root, 'proj'),
      homeDir: '/home/me',
      additionalDirectories: [],
    })

  test('a deny on a folder refuses a read through a link into it', async () => {
    const root = tree()
    symlinkSync(join(root, 'secret'), join(root, 'proj', 'link'))
    const rules = at(root, entry('deny', `Read(/${root}/secret/**)`))
    const read = { path: 'link/key' }
    // The requested path alone is under the project, where no rule applies.
    expect(settingsVerdict(rules, { name: 'Read' }, read)).toBeUndefined()
    const resolved = await settingsResolvedPaths(rules, { name: 'Read' }, read)
    expect(settingsVerdict(rules, { name: 'Read' }, read, resolved)?.effect).toBe('deny')
    const plain = { path: 'notes.md' }
    const none = await settingsResolvedPaths(rules, { name: 'Read' }, plain)
    expect(settingsVerdict(rules, { name: 'Read' }, plain, none)).toBeUndefined()
  })

  test('a deny written through a linked folder also holds at its real location', async () => {
    const root = tree()
    symlinkSync(join(root, 'secret'), join(root, 'alias'))
    const rules = await withRealDirectories(at(root, entry('deny', `Read(/${root}/alias/**)`)))
    const read = { path: join(root, 'secret', 'key') }
    expect(settingsVerdict(rules, { name: 'Read' }, read)?.effect).toBe('deny')
  })
})
