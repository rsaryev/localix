/**
 * PROJECTS search provider (agent-core search) — matches project name + working dir
 * over the existing projects service. Hit ids reuse the `localix://resource/chat/project/<id>` grammar
 * the chat resource provider owns, so a result opens the project AND drops into chat
 * as a native `@project:` ref. `eager` (a small indexed per-user table).
 */
import type { SearchHit, SearchProvider } from '../agent-core/search/provider'
import { bestFieldScore } from '../agent-core/search/match'
import { localixResourceUri } from '@localixai/mini-app-sdk/navigation'

/** One project as the provider reads it. */
export interface ProjectSearchRow {
  id: string
  name: string
  workingDir: string
}

export interface ProjectsSearchPort {
  listProjects(userId: string): Promise<ProjectSearchRow[]>
}

export function createProjectsSearchProvider(port: ProjectsSearchPort): SearchProvider {
  return {
    id: 'projects',
    title: 'Projects',
    tier: 'eager',
    icon: 'project',
    async search(userId, query) {
      const rows = await port.listProjects(userId).catch(() => [] as ProjectSearchRow[])
      const hits: SearchHit[] = []
      for (const p of rows) {
        const score = bestFieldScore([p.name, p.workingDir], query.text)
        if (score <= 0) continue
        hits.push({
          id: localixResourceUri('chat', ['project', p.id]),
          domain: 'projects',
          title: p.name,
          subtitle: p.workingDir,
          icon: 'project',
          score,
        })
      }
      return hits
    },
  }
}
