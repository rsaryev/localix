import { promises as fs } from 'node:fs'
import path from 'node:path'
import { api, repoRoot } from './runtime.mjs'

const samples = [
  [
    'Project files',
    '```tree\nrelease-studio/\n├── src/\n│   ├── release.ts\n│   └── release.test.ts\n├── index.html\n└── package.json\n```',
  ],
  [
    'Review steps',
    '> [!STEPS] Ship the workspace update\n> 1. **Review the interface**\n>    Check desktop and mobile layouts.\n> 2. **Run the release checks**\n>    Cover pending and ready states.\n> 3. **Publish release notes**\n>    Link the changes and final checks.',
  ],
  [
    'Release summary',
    '> [!STATS]\n> - **6** release checks\n> - **3** collaborators\n> - **2** passing tests',
  ],
  [
    'Release checklist',
    '- [x] Review the workspace layout\n- [x] Check the release states\n- [ ] Review the mobile preview\n- [ ] Write release notes',
  ],
  [
    'Release notes',
    '> [!TABS]\n> ## Interface\n> The source and preview share a workspace.\n> ## Checks\n> Both pending and ready states are covered.',
  ],
  [
    'Decision notes',
    '> [!PROS]\n> - Keep review context visible\n> - Share one release plan\n\n> [!CONS]\n> - Finish the release notes first',
  ],
]

export async function seedAnswerBoard(fixture) {
  const root = path.join(path.dirname(fixture.root), 'markdown-guide')
  await fs.mkdir(root, { recursive: true })
  await fs.cp(
    path.join(repoRoot, 'docs/assets/screenshots/fixtures/release-studio/src'),
    path.join(root, 'src'),
    { recursive: true },
  )
  const result = await api('/projects')
  const projects = Array.isArray(result) ? result : result.projects
  const project =
    projects.find((item) => item.workingDir === root) ??
    (await api('/projects', { name: 'Markdown Guide', workingDir: root }))
  if (!fixture.boardSessionId) {
    const session = await api('/sessions', {
      title: 'Review the rendered components',
      projectId: project.id,
      agentIds: ['builtin:lead'],
    })
    fixture.boardSessionId = session.id
  }
  fixture.boardProjectId = project.id
  const route = `/project-space/space?sessionId=${fixture.boardSessionId}`
  const { space } = await api(route)
  const ops = samples.flatMap(([title, text], i) => {
    const id = `capture-component-${i}`
    return space.elements[id]
      ? []
      : [
          {
            op: 'create',
            id,
            type: 'text',
            x: 80 + (i % 3) * 460,
            y: 80 + Math.floor(i / 3) * 340,
            w: 410,
            h: 280,
            props: { text: `## ${title}\n\n${text}`, size: 'md' },
          },
        ]
  })
  if (ops.length) await api(`/project-space/ops?sessionId=${fixture.boardSessionId}`, { ops })
}
