import { expect, test } from 'bun:test'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'
import { nestedSkillsForTouched } from './nested-skills'

// skills.md, "Load skills in monorepos and subdirectories": skills in a `.claude/skills/` below the
// working directory "load the first time Claude reads or edits a file in that subdirectory"; one
// whose name another skill has is listed as `/apps/web:deploy`.
const dir = tempDirPerTest('nested-skills-')
const write = async (path: string, text: string) => {
  await fs.mkdir(join(path, '..'), { recursive: true })
  await fs.writeFile(path, text)
}

test('a subfolder’s skills load once a file there is worked with, a clash qualified by folder', async () => {
  const web = join(dir(), 'apps', 'web')
  await write(
    join(web, '.claude', 'skills', 'deploy', 'SKILL.md'),
    '---\nname: deploy\ndescription: web deploy\n---\nDeploy web.',
  )
  await write(
    join(web, '.claude', 'skills', 'storybook', 'SKILL.md'),
    '---\nname: storybook\ndescription: stories\n---\nStories.',
  )
  expect(await nestedSkillsForTouched(dir(), [], new Set(['deploy']))).toEqual([])
  const skills = await nestedSkillsForTouched(
    dir(),
    [join(web, 'src', 'App.tsx')],
    new Set(['deploy']),
  )
  expect(skills.map((s) => [s.name, s.description]).sort()).toEqual([
    ['apps/web:deploy', 'web deploy (for files in apps/web)'],
    ['storybook', 'stories'],
  ])
})
