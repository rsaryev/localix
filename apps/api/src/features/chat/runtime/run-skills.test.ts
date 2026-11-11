import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { tempDirPerTest, writeTree } from '@localixai/testing'
import { composeCapabilities } from '../../capabilities/resolve'
import { skillTestSession } from '../../plugins/kit/testing'
import type { PersistedMessage } from '../contracts'
import type { SessionRecord } from '../repository'
import { resolveRunSkills } from './run-skills'

const dir = tempDirPerTest('run-skills')
const signal = new AbortController().signal
const work = () => join(dir(), 'work')
const skillFile = (frontmatter: string, body: string) => `---\n${frontmatter}\n---\n${body}\n`

const userSays = (content: string) =>
  ({ payload: { role: 'user', content } }) as unknown as PersistedMessage
const readFile = (path: string) =>
  ({
    payload: {
      role: 'assistant',
      content: '',
      items: [{ type: 'tool_call', name: 'Read', input: { file_path: path } }],
    },
  }) as unknown as PersistedMessage

async function run(
  session: Partial<SessionRecord>,
  history: PersistedMessage[],
  options: {
    deny?: string
    agentSkills?: string[]
    plugins?: string[]
    agentSource?: { kind: 'plugin'; pluginId: string }
  } = {},
) {
  writeTree(work(), {
    '.git/HEAD': 'ref: refs/heads/main\n',
    '.claude/skills/deploy/SKILL.md': skillFile(
      'description: Deploys\nkeywords: ship it, deploy',
      'Deploy steps',
    ),
    '.claude/skills/review/SKILL.md': skillFile('description: Reviews', 'Review steps'),
    '.claude/skills/hidden/SKILL.md': skillFile(
      'description: Hidden\ndisable-model-invocation: true',
      'Hidden steps',
    ),
    '.claude/skills/web/SKILL.md': skillFile('description: Web\npaths: "src/**"', 'Web steps'),
  })
  const kit = await skillTestSession(join(dir(), 'home'), work(), options.plugins)
  return resolveRunSkills(kit, {
    capabilities: composeCapabilities(
      options.deny ? [{ action: options.deny, resource: '*', effect: 'deny' }] : [],
    ),
    session: { id: 's1', ...session } as SessionRecord,
    ...(options.agentSkills ? { agentSkills: options.agentSkills } : {}),
    ...(options.agentSource ? { agentSource: options.agentSource } : {}),
    history,
    cwd: work(),
    signal,
  })
}

describe("a run's skills, read from the chat's plugin session", () => {
  test("the model's listing is the kit's, less the agent's `skill:` denials", async () => {
    const skills = await run({}, [], { deny: 'skill:review' })
    expect(skills.skillsContext).toContain('- deploy: Deploys')
    expect(skills.skillsContext).not.toContain('review')
    expect(skills.skillsContext).not.toContain('Hidden')
    expect(skills.skillOverrides).toEqual({ review: 'off' })
  })

  test('a file the session worked with activates a `paths` skill', async () => {
    const before = await run({}, [])
    expect(before.skillsContext).not.toContain('- web: Web')
    const after = await run({}, [readFile(join(work(), 'src/app.ts'))])
    expect(after.skillsContext).toContain('- web: Web')
  })

  test("a pin is the person's choice: a model-hidden skill is pinned, a denied one is not", async () => {
    const skills = await run({ pinnedSkills: ['hidden', 'review'] }, [], { deny: 'skill:review' })
    expect(skills.pinnedSkills.map((one) => one.name)).toEqual(['hidden'])
    expect(skills.pinnedSkills[0]!.content).toContain('Hidden steps')
  })

  test("a delegated child preloads its agent file's skills as the kit plans them", async () => {
    const skills = await run(
      { provenance: { kind: 'task-delegation', agentType: 'reviewer' } } as Partial<SessionRecord>,
      [],
      { agentSkills: ['hidden', 'review'] },
    )
    expect(skills.pinnedSkills.map((one) => one.name)).toEqual(['review'])
  })

  test("a plugin agent's bare preload finds its own plugin's skill first", async () => {
    const plugins = ['first', 'second'].map((name) => {
      const root = join(dir(), name)
      writeTree(root, {
        '.claude-plugin/plugin.json': JSON.stringify({ name }),
        'skills/lint/SKILL.md': skillFile(`description: ${name} lints`, `${name} lint`),
      })
      return root
    })
    const skills = await run(
      {
        provenance: { kind: 'task-delegation', agentType: 'second:checker' },
      } as Partial<SessionRecord>,
      [],
      { agentSkills: ['lint'], plugins, agentSource: { kind: 'plugin', pluginId: 'second@test' } },
    )
    expect(skills.pinnedSkills.map((one) => one.name)).toEqual(['second:lint'])
  })

  test("a keyword of the person's message puts the skill in, unless it is pinned", async () => {
    const said = [userSays('please ship it today')]
    const fired = await run({}, said)
    expect(fired.triggeredSkills).toEqual([
      expect.objectContaining({ name: 'deploy', keyword: 'ship it' }),
    ])
    expect(fired.triggeredSkills[0]!.content).toContain('Deploy steps')
    expect((await run({ pinnedSkills: ['deploy'] }, said)).triggeredSkills).toEqual([])
  })

  test('a plugin the agent may not use lists none of its skills', async () => {
    const tools = join(dir(), 'tools')
    writeTree(tools, {
      '.claude-plugin/plugin.json': JSON.stringify({ name: 'tools' }),
      'skills/fancy/SKILL.md': skillFile('description: Fancy', 'Fancy steps'),
    })
    expect((await run({}, [], { plugins: [tools] })).skillsContext).toContain('tools:fancy')
    const denied = await run({}, [], { plugins: [tools], deny: 'plugin:tools' })
    expect(denied.skillsContext).not.toContain('fancy')
    expect(denied.skillOverrides).toEqual({ 'tools:fancy': 'off' })
  })

  test("a subfolder's skills load once the session works with a file there", async () => {
    writeTree(work(), {
      'apps/web/.claude/skills/bundle/SKILL.md': skillFile('description: Bundles', 'Bundle steps'),
    })
    expect((await run({}, [])).skillsContext).not.toContain('bundle')
    const touched = await run({}, [readFile(join(work(), 'apps/web/index.ts'))])
    expect(touched.skillsContext).toContain('bundle')
  })
})
