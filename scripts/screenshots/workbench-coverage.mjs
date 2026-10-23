import { promises as fs } from 'node:fs'
import path from 'node:path'
import { repoRoot } from './runtime.mjs'
import { capturePlan, retainedShots } from './plan.mjs'
import { readExtensionManifest } from '../lib/extension-manifest.mjs'
import { miniAppsRoot } from '../lib/bundled-roots.mjs'

// A catalog or adjacent chat is not evidence for a different owner's workbench.
export const workbenchEvidence = {
  api: ['api/request-response', 'features/api.md'],
  documents: ['documents/viewer', 'features/documents.md'],
  reader: ['reader/document', 'features/reader.md'],
  database: ['database/console', 'features/database.md'],
  resume: ['resume/editor-wide', 'features/resumes.md'],
  'code-graph': ['code-graph/project', 'features/code-graph.md'],
  'git-workspace': ['source-control/review', 'features/source-control.md'],
  learning: ['learning/course', 'features/learning-loop.md'],
  'project-space': ['project-space/answer-components', 'features/project-space.md'],
  kanban: ['task-board/board', 'features/task-board.md'],
  devops: ['devops/containers', 'features/devops.md'],
  trading: ['trading/market-chart', 'features/trading.md'],
  template: ['system/overview', 'extending/mini-apps.md'],
  'game-2048': ['games/2048', 'features/game-2048.md'],
  chess: ['games/chess', 'features/games.md'],
  checkers: ['games/checkers', 'features/games.md'],
  battleship: ['games/battleship', 'features/games.md'],
  'tic-tac-toe': ['games/tic-tac-toe', 'features/games.md'],
  'rock-paper-scissors': ['games/rock-paper-scissors', 'features/games.md'],
}
// DevOps owns two providers; a Docker image does not prove its Kubernetes surfaces.
export const additionalSurfaceEvidence = {
  'devops/kubernetes': ['kubernetes/pod-logs', 'features/kubernetes.md'],
}

export async function inspectWorkbenchCoverage() {
  const bundledRoot = miniAppsRoot(repoRoot)
  const miniAppDirs = await fs.readdir(bundledRoot, { withFileTypes: true })
  const owners = []
  for (const dir of miniAppDirs.filter((entry) => entry.isDirectory())) {
    const manifest = readExtensionManifest(path.join(bundledRoot, dir.name))
    if (manifest.surfaces?.includes('workbench')) owners.push(dir.name)
  }
  const shots = await fs.readdir(path.join(repoRoot, 'docs/assets/screenshots'), {
    recursive: true,
  })
  const rows = []
  for (const owner of [...owners.sort(), ...Object.keys(additionalSurfaceEvidence)]) {
    const mapping = workbenchEvidence[owner] ?? additionalSurfaceEvidence[owner]
    const [key, guide] = mapping ?? []
    const dated =
      key &&
      shots
        .filter((file) => file.startsWith(`${key}--`) && /--\d{4}-\d{2}-\d{2}\.png$/.test(file))
        .sort()
        .at(-1)
    const source = guide ? await fs.readFile(path.join(repoRoot, 'docs', guide), 'utf8') : ''
    rows.push({
      owner,
      key: key ?? 'MISSING OWNER MAPPING',
      guide: guide ?? '',
      scenario: Boolean(key && capturePlan[key]),
      retained: Boolean(key && retainedShots[key]),
      capture: dated ?? '',
      linked: Boolean(dated && source.includes(`screenshots/${dated}`)),
    })
  }
  return rows
}

if (import.meta.main) {
  const rows = await inspectWorkbenchCoverage()
  console.table(rows)
  const gaps = rows.filter((row) => (!row.scenario && !row.retained) || !row.capture || !row.linked)
  if (gaps.length) {
    console.log(
      `${gaps.length} workbench evidence gaps remain; ready scenarios alone are not captures.`,
    )
    process.exitCode = 1
  }
}
