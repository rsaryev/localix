import type { HighlightId } from '../../pages/homeHighlights'
import { BrowserScene, ContextScene, PluginScene } from './cards/workflowScenes'
import { CliScene, SpaceScene, TeamScene } from './cards/agentScenes'
import { GitScene, GraphScene, KanbanScene } from './cards/toolScenes'
import { ApiScene, DatabaseScene, DevOpsScene } from './cards/opsScenes'

/** Drawn workflow illustrations, not recorded sessions or product screenshots. */
const scenes = {
  plugins: PluginScene,
  browser: BrowserScene,
  context: ContextScene,
  team: TeamScene,
  external: CliScene,
  space: SpaceScene,
  git: GitScene,
  graph: GraphScene,
  kanban: KanbanScene,
  database: DatabaseScene,
  api: ApiScene,
  devops: DevOpsScene,
}

export function FeatureIllustration({ kind }: { kind: HighlightId }) {
  const Scene = scenes[kind]
  return <Scene />
}
