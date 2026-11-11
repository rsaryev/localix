import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { tempDirPerTest, writeTree } from '@localixai/testing'
import { skillPlugin } from '@rsaryev/llx-plugin'
import { invokeSkill } from './skills'
import {
  findSessionSkill,
  sessionSkills,
  projectOrGlobal,
  skillListing,
  touchSessionFiles,
  typedSkills,
} from './skill-catalog'
import { skillTestSession, writeTestPlugin } from './testing'

const dir = tempDirPerTest('kit-skill-catalog')
const signal = new AbortController().signal
const home = () => join(dir(), 'home')
const work = () => join(dir(), 'work')

const skillFile = (frontmatter: string, body = 'Do it') => `---\n${frontmatter}\n---\n${body}\n`

/** A session over `work` (a repository) with these files below it and the plugin `tools`. */
async function session(files: Record<string, string>, plugin: Record<string, string> = {}) {
  writeTree(work(), { '.git/HEAD': 'ref: refs/heads/main\n', ...files })
  const plugins = Object.keys(plugin).length
    ? [await writeTestPlugin(join(dir(), 'tools'), 'tools', plugin)]
    : []
  const chat = await skillTestSession(
    home(),
    work(),
    plugins.map((one) => one.root),
  )
  await chat.reloadSkills({ signal })
  return chat
}

describe('the skills of a chat, as the kit lists and expands them', () => {
  test('a plugin skill is listed by its folder, and its frontmatter name finds it too', async () => {
    const chat = await session(
      {},
      { 'skills/fancy-folder/SKILL.md': skillFile('name: fancy\ndescription: Fancy things') },
    )
    const row = sessionSkills(chat).find((one) => one.source.kind === 'plugin')
    const root = join(dir(), 'tools')
    expect(row).toMatchObject({
      invocable: {
        command: 'tools:fancy-folder',
        name: 'fancy-folder',
        description: 'Fancy things',
      },
      names: ['tools:fancy-folder', 'tools:fancy', 'fancy'],
      source: { kind: 'plugin', pluginId: 'tools@test' },
      file: join(root, 'skills/fancy-folder/SKILL.md'),
      directory: join(root, 'skills/fancy-folder'),
    })
    expect(row && skillPlugin(row)).toEqual({ id: 'tools@test', name: 'tools' })
    // Claude Code 2.1.322: the frontmatter `name` is a name the skill answers to, not one it is
    // listed by (the kit's `Skill.declaredCommand`).
    expect(findSessionSkill(chat, 'fancy')?.invocable.command).toBe('tools:fancy-folder')
    expect(findSessionSkill(chat, 'tools:fancy')?.invocable.command).toBe('tools:fancy-folder')
    for (const one of sessionSkills(chat)) {
      const invoked = await invokeSkill(chat, one.invocable.command, { invoker: 'model', signal })
      expect(invoked.ok).toBe(true)
    }
  })

  test('a folder skill carries its file, its scope and who may invoke it; a command file is a command', async () => {
    const chat = await session({
      '.claude/skills/deploy/SKILL.md': skillFile(
        'description: Deploys\nargument-hint: [env]\narguments: env\ndisable-model-invocation: true',
      ),
      '.claude/commands/tidy.md': skillFile('description: Tidies'),
    })
    const deploy = findSessionSkill(chat, 'deploy')
    expect(deploy).toMatchObject({
      invocable: { kind: 'skill', argumentHint: '[env]', arguments: ['env'] },
      file: join(work(), '.claude/skills/deploy/SKILL.md'),
      directory: join(work(), '.claude/skills/deploy'),
      policy: { user: true, model: false },
      listed: 'hidden',
    })
    expect(deploy && projectOrGlobal(deploy)).toBe('project')
    const tidy = findSessionSkill(chat, 'tidy')
    expect(tidy?.invocable.kind).toBe('command')
    expect(tidy && projectOrGlobal(tidy)).toBe('project')
    expect(findSessionSkill(chat, 'nope')).toBeUndefined()
  })

  test('a typed message names its leading skills, their arguments and the ones it permits', async () => {
    const chat = await session(
      { '.claude/skills/deploy/SKILL.md': skillFile('description: Deploys') },
      { 'skills/fancy/SKILL.md': skillFile('description: Fancy') },
    )
    const typed = typedSkills(chat, '/tools:fancy /deploy staging')
    expect(typed.leading.map((one) => one.invocable.command)).toEqual(['tools:fancy', 'deploy'])
    expect(typed.arguments).toBe('staging')
    const named = typedSkills(chat, 'go ahead and /deploy now')
    expect(named.leading).toEqual([])
    expect([...named.permitted]).toEqual(['deploy'])
    expect(typedSkills(chat, '/compact').leading).toEqual([])
  })

  test("the model's listing names a paths skill alone until a touched file activates it", async () => {
    const chat = await session({
      '.claude/skills/web/SKILL.md': skillFile('description: Web work\npaths: apps/web/**'),
      '.claude/skills/ship/SKILL.md': skillFile(
        'description: Ships\ndisable-model-invocation: true',
      ),
      'apps/web/index.ts': 'export {}\n',
    })
    expect(skillListing(chat)).toBe('- web')
    expect(await touchSessionFiles(chat, [join(work(), 'apps/web/index.ts')], signal)).toEqual([
      'web',
    ])
    expect(skillListing(chat)).toBe('- web: Web work')
    expect(skillListing(chat, { denied: new Set(['web']) })).toBeUndefined()
  })

  test('the skills of a folder below the working directory load once a file there is touched', async () => {
    const chat = await session({
      'apps/api/.claude/skills/migrate/SKILL.md': skillFile('description: Migrates'),
      'apps/api/db.ts': 'export {}\n',
    })
    expect(findSessionSkill(chat, 'migrate')).toBeUndefined()
    await touchSessionFiles(chat, [join(work(), 'apps/api/db.ts')], signal)
    const migrate = findSessionSkill(chat, 'migrate')
    expect(migrate && projectOrGlobal(migrate)).toBe('project')
  })
})
