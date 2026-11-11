import { expect, test } from 'bun:test'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'
import { skillPromptInput } from './skill-prompt'

/**
 * What a `skill.prompt` hook is told about the skill it rewrites (plugins/mods/reference.md, "Source
 * and frontmatter fields on `skill.prompt`"): its frontmatter as the file declares it, whose words
 * it is, its plugin, its file and, for a block that does not parse, why it has no frontmatter.
 */
const dir = tempDirPerTest('kit-skill-prompt-')

async function skillFile(name: string, text: string) {
  const path = join(dir(), name, 'SKILL.md')
  await mkdir(join(dir(), name), { recursive: true })
  await writeFile(path, text)
  return path
}

test('a plugin skill is told its frontmatter, source, plugin and path', async () => {
  const path = await skillFile('commit', '---\nname: commit\nallowed-tools: [Bash]\n---\nCommit.')
  expect(
    await skillPromptInput('kit:commit', 'Commit.', { path, scope: 'project', pluginName: 'kit' }),
  ).toEqual({
    skill: 'kit:commit',
    text: 'Commit.',
    source: 'plugin',
    pluginName: 'kit',
    path,
    frontmatter: { name: 'commit', 'allowed-tools': ['Bash'] },
  })
})

test('a person’s own skill is userSettings or projectSettings by where it lives', async () => {
  const path = await skillFile('notes', 'Notes, no frontmatter.')
  expect(await skillPromptInput('notes', 'N', { path, scope: 'global' })).toMatchObject({
    source: 'userSettings',
    frontmatter: {},
  })
  expect(await skillPromptInput('notes', 'N', { path, scope: 'project' })).toMatchObject({
    source: 'projectSettings',
  })
})

test('a skill with no file reads as built in, with no frontmatter', async () => {
  expect(await skillPromptInput('help', 'Help.')).toEqual({
    skill: 'help',
    text: 'Help.',
    source: 'built-in',
    frontmatter: {},
  })
})

test('a frontmatter block that does not parse says why it is missing', async () => {
  const path = await skillFile('broken', '---\nname: "unclosed\n---\nBody.')
  const input = await skillPromptInput('broken', 'Body.', { path, scope: 'project' })
  expect(input.frontmatter).toEqual({})
  expect(input.frontmatterProblem).toBeString()
})
