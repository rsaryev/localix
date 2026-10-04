/**
 * SKILLS search provider (agent-core search) — matches skill name + description over
 * the discovered skills. Every hit addresses one row in its exact project scope.
 */
import type { SearchHit, SearchProvider } from '../agent-core/search/provider'
import { bestFieldScore } from '../agent-core/search/match'
import { settingsEntityUiUri } from '@localixai/plugin-sdk/navigation'

export interface SkillSearchRow {
  name: string
  description: string
}

export interface SkillsSearchPort {
  listSkills(userId: string, projectId?: string | null): Promise<SkillSearchRow[]>
}

export function createSkillsSearchProvider(port: SkillsSearchPort): SearchProvider {
  return {
    id: 'skills',
    title: 'Skills',
    tier: 'eager',
    icon: 'skill',
    async search(userId, query) {
      const rows = await port
        .listSkills(userId, query.projectId)
        .catch(() => [] as SkillSearchRow[])
      const hits: SearchHit[] = []
      for (const s of rows) {
        const score = bestFieldScore([s.name, s.description], query.text)
        if (score <= 0) continue
        hits.push({
          id: settingsEntityUiUri('skills', 'skill', s.name, query.projectId ?? ''),
          domain: 'skills',
          title: s.name,
          subtitle: s.description,
          icon: 'skill',
          score,
        })
      }
      return hits
    },
  }
}
