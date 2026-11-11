import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { tempDirPerTest, writeTree } from '@localixai/testing'
import { skillKeywords } from '@rsaryev/llx-plugin'
import { sessionSkills } from './skill-catalog'
import { preloadedSkillTexts, skillTexts } from './skill-texts'
import { scopeSkills } from './scope-skills'
import { diskPluginHost, skillTestSession, writeTestPlugin } from './testing'

const dir = tempDirPerTest('kit-skill-texts')
const signal = new AbortController().signal
const home = () => join(dir(), 'home')
const work = () => join(dir(), 'work')

const skillFile = (frontmatter: string, body = 'Do it') => `---\n${frontmatter}\n---\n${body}\n`

async function session(files: Record<string, string>) {
  writeTree(work(), { '.git/HEAD': 'ref: refs/heads/main\n', ...files })
  const chat = await skillTestSession(home(), work())
  await chat.reloadSkills({ signal })
  return chat
}

describe('the text of a skill a host puts in the prompt', () => {
  test('a skill the person pinned is read as its file holds it, a model-hidden one too', async () => {
    const chat = await session({
      '.claude/skills/ship/SKILL.md': skillFile(
        'description: Ships\ndisable-model-invocation: true',
        'Ship $ARGUMENTS with !`date`',
      ),
    })
    expect(await skillTexts(chat, ['ship', 'missing'], signal)).toEqual([
      {
        name: 'ship',
        content: `Resolve relative references from: ${JSON.stringify(join(work(), '.claude/skills/ship'))}\n\nShip $ARGUMENTS with !\`date\`\n`,
      },
    ])
  })

  test("an agent's preloaded skills are the kit's: one Claude may not invoke is skipped", async () => {
    const chat = await session({
      '.claude/skills/ship/SKILL.md': skillFile(
        'description: Ships\ndisable-model-invocation: true',
      ),
      '.claude/skills/lint/SKILL.md': skillFile('description: Lints', 'Lint it'),
    })
    const texts = await preloadedSkillTexts(chat, ['ship', 'lint'], signal)
    expect(texts.map((one) => one.name)).toEqual(['lint'])
    expect(texts[0]!.content).toContain('Lint it')
  })

  test("a plugin agent's bare preload name is its own plugin's skill first", async () => {
    // Both plugins have `lint`; the first in load order is `first`, the agent is `second`'s.
    await writeTestPlugin(join(dir(), 'first'), 'first', {
      'skills/lint/SKILL.md': skillFile('description: First lints', 'First lint'),
    })
    await writeTestPlugin(join(dir(), 'second'), 'second', {
      'skills/lint/SKILL.md': skillFile('description: Second lints', 'Second lint'),
    })
    writeTree(work(), { '.git/HEAD': 'ref: refs/heads/main\n' })
    const chat = await skillTestSession(home(), work(), [
      join(dir(), 'first'),
      join(dir(), 'second'),
    ])
    await chat.reloadSkills({ signal })
    const own = { kind: 'plugin', pluginId: 'second@test' } as const
    expect((await preloadedSkillTexts(chat, ['lint'], signal, own)).map((t) => t.name)).toEqual([
      'second:lint',
    ])
    expect((await preloadedSkillTexts(chat, ['lint'], signal)).map((t) => t.name)).toEqual([
      'first:lint',
    ])
  })

  test('a frontmatter `keywords` list, which only Localix reads, rides on the row', async () => {
    const chat = await session({
      '.claude/skills/deploy/SKILL.md': skillFile(
        'description: Deploys\nkeywords: deploy to prod, rollback',
      ),
    })
    const deploy = sessionSkills(chat).find((one) => one.invocable.command === 'deploy')
    expect(deploy && skillKeywords(deploy)).toEqual(['deploy to prod', 'rollback'])
  })
})

describe('the skills of a scope outside any chat', () => {
  test("its folders' and its selected plugins' skills, with what the kit found wrong", async () => {
    writeTree(work(), {
      '.git/HEAD': 'ref: refs/heads/main\n',
      '.claude/skills/deploy/SKILL.md': skillFile('description: Deploys'),
      '.claude/skills/broken/SKILL.md': skillFile('description: Odd\neffort: extreme'),
    })
    const tools = await writeTestPlugin(join(dir(), 'tools'), 'tools', {
      'skills/fancy/SKILL.md': skillFile('description: Fancy'),
    })
    const off = await writeTestPlugin(
      join(dir(), 'off'),
      'off',
      { 'skills/hidden/SKILL.md': skillFile('description: Hidden') },
      false,
    )
    const read = await scopeSkills(diskPluginHost(home()), {
      cwd: work(),
      homeDir: home(),
      managed: null,
      plugins: [tools, off],
    })
    expect(read.skills.map((one) => one.invocable.command).sort()).toEqual([
      'broken',
      'deploy',
      'tools:fancy',
    ])
    expect(read.issues.some((issue) => issue.path.endsWith('broken/SKILL.md'))).toBe(true)
  })
})
