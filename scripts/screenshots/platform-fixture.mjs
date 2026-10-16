import { promises as fs } from 'node:fs'
import path from 'node:path'
import { api, repoRoot } from './runtime.mjs'

export async function seedPlatform(fixture) {
  let root = path.join(path.dirname(fixture.root), 'platform-studio')
  await fs.mkdir(root, { recursive: true })
  await fs.cp(path.join(repoRoot, 'docs/assets/screenshots/fixtures/release-studio'), root, {
    recursive: true,
    force: false,
    errorOnExist: false,
  })
  const modules = {
    'checks.ts':
      "import type { Release } from './release'\n\nexport function completedChecks(release: Release) {\n  return release.checks.filter((check) => check.done)\n}\n\nexport function progress(release: Release) {\n  return completedChecks(release).length / release.checks.length\n}\n",
    'preview.ts':
      "import { release, isReady } from './release'\nimport { progress } from './checks'\n\nexport function releasePreview() {\n  return { title: release.title, ready: isReady(release), progress: progress(release) }\n}\n",
    'plan.ts':
      "import type { Release } from './release'\nimport { progress } from './checks'\n\nexport class ReleasePlan {\n  constructor(readonly release: Release) {}\n\n  completeCheck(label: string) {\n    const check = this.release.checks.find((item) => item.label === label)\n    if (check) check.done = true\n    return progress(this.release)\n  }\n}\n",
    'workspace.ts':
      "import { release } from './release'\nimport { ReleasePlan } from './plan'\nimport { releasePreview } from './preview'\n\nexport const workspacePlan = new ReleasePlan(release)\nexport const preview = releasePreview()\n",
  }
  for (const [file, content] of Object.entries(modules))
    await fs.writeFile(path.join(root, 'src', file), content)
  await fs.writeFile(path.join(root, '.gitignore'), '.localix/\nrelease.sqlite\n')
  root = await fs.realpath(root)
  const result = await api('/projects')
  const projects = Array.isArray(result) ? result : result.projects
  let project
  for (const candidate of projects) {
    try {
      if ((await fs.realpath(candidate.workingDir)) === root) {
        project = candidate
        break
      }
    } catch {}
  }
  project ??= await api('/projects', { name: 'Platform Studio', workingDir: root })
  if (!fixture.platformSessionId) {
    const session = await api('/sessions', {
      title: 'Explore the workspace tools',
      projectId: project.id,
      agentIds: ['builtin:localix'],
    })
    fixture.platformSessionId = session.id
  }
  fixture.platformProjectId = project.id
  fixture.platformRoot = root
  return root
}
