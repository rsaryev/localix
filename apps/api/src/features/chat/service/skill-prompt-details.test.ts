import { expect, test } from 'bun:test'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'
import { skillPrompt } from '../../mods/conversation-events'
import { hostWithMod } from '../../mods/testing/testing-host'
import { createSkillTool } from '../../agent-core/tools/skill'
import { testSkillPorts } from '../../agent-core/testing/skill-ports'

// claude-code types, `SkillPromptInput`: a hook on `skill.prompt` is handed the skill's
// `frontmatter` "as its author wrote it", its `source` (`userSettings`, `projectSettings`,
// `plugin`, …), the `pluginName` and the `path` of the file it was loaded from.
const dir = tempDirPerTest('skill-prompt-details-')

test('skill.prompt carries the skill’s frontmatter, source, plugin and path', async () => {
  const path = join(dir(), 'commit', 'SKILL.md')
  await mkdir(join(dir(), 'commit'), { recursive: true })
  await writeFile(
    path,
    '---\nname: commit\ndescription: Commit\nallowed-tools: [Bash]\n---\nCommit.',
  )
  const seen: unknown[] = []
  const { host, scene } = await hostWithMod((on) => {
    on('skill.prompt', ($, e: any) => {
      seen.push({
        frontmatter: e.frontmatter,
        source: e.source,
        pluginName: e.pluginName,
        path: e.path,
      })
      return { text: e.text }
    })
  })
  await skillPrompt(host, scene, 'kit:commit', 'Commit.', {
    path,
    scope: 'project',
    pluginName: 'kit',
  })
  expect(seen).toEqual([
    {
      frontmatter: { name: 'commit', description: 'Commit', 'allowed-tools': ['Bash'] },
      source: 'plugin',
      pluginName: 'kit',
      path,
    },
  ])
})

test('a skill the agent loads tells skill.prompt the same', async () => {
  const path = join(dir(), 'zz-details', 'SKILL.md')
  await mkdir(join(dir(), 'zz-details'), { recursive: true })
  await writeFile(path, '---\nname: zz-details\ndescription: d\n---\nBody.')
  const seen: unknown[] = []
  const { scope } = await hostWithMod((on) => {
    on(
      'skill.prompt',
      ($, e: any) => (seen.push([e.source, e.path, e.frontmatter.name]), { text: e.text }),
    )
  })
  const tool = createSkillTool(
    null,
    {},
    '',
    undefined,
    testSkillPorts([
      { name: 'zz-details', content: 'Body.', path, dir: join(dir(), 'zz-details') },
    ]),
  )
  const [wrapped] = scope.wrapTools([tool as never])
  await (wrapped as typeof tool).execute('t', { action: 'get', name: 'zz-details' })
  expect(seen).toEqual([['projectSettings', path, 'zz-details']])
})
