import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { tempDirPerTest, writeTree } from '@localixai/testing'
import { invokeSkill } from './skills'
import {
  findSessionSkill,
  reloadSessionSkills,
  sessionSkills,
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
  await reloadSessionSkills(chat, signal)
  return chat
}

describe('the skills of a chat, as the kit lists and expands them', () => {
  test('a plugin skill is listed by the name the kit runs it by: its folder, whatever its frontmatter name', async () => {
    const chat = await session(
      {},
      { 'skills/fancy-folder/SKILL.md': skillFile('name: fancy\ndescription: Fancy things') },
    )
    const row = sessionSkills(chat).find((one) => one.plugin)
    const root = join(dir(), 'tools')
    expect(row).toMatchObject({
      name: 'tools:fancy-folder',
      names: ['tools:fancy-folder'],
      ownName: 'fancy-folder',
      description: 'Fancy things',
      plugin: { id: 'tools@test', name: 'tools' },
      path: join(root, 'skills/fancy-folder/SKILL.md'),
      dir: join(root, 'skills/fancy-folder'),
    })
    // Claude Code 2.1.319 and later: the frontmatter `name` gives a scanned plugin skill no name.
    expect(findSessionSkill(chat, 'fancy')).toBeUndefined()
    expect(findSessionSkill(chat, 'tools:fancy')).toBeUndefined()
    for (const one of sessionSkills(chat)) {
      const invoked = await invokeSkill(chat, one.name, { invoker: 'model', signal })
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
    expect(findSessionSkill(chat, 'deploy')).toMatchObject({
      kind: 'skill',
      scope: 'project',
      path: join(work(), '.claude/skills/deploy/SKILL.md'),
      dir: join(work(), '.claude/skills/deploy'),
      argumentHint: '[env]',
      argumentNames: ['env'],
      userInvocable: true,
      modelInvocable: false,
      listed: 'hidden',
    })
    expect(findSessionSkill(chat, 'tidy')).toMatchObject({ kind: 'command', scope: 'project' })
    expect(findSessionSkill(chat, 'nope')).toBeUndefined()
  })

  test('a typed message names its leading skills, their arguments and the ones it permits', async () => {
    const chat = await session(
      { '.claude/skills/deploy/SKILL.md': skillFile('description: Deploys') },
      { 'skills/fancy/SKILL.md': skillFile('description: Fancy') },
    )
    const typed = typedSkills(chat, '/tools:fancy /deploy staging')
    expect(typed.leading.map((one) => one.name)).toEqual(['tools:fancy', 'deploy'])
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
    expect(findSessionSkill(chat, 'migrate')).toMatchObject({ scope: 'project' })
  })
})
