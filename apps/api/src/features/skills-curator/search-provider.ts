/**
 * SKILLS search provider (agent-core search) — matches skill name + description over
 * the discovered skills. Every hit addresses one row in its exact project scope.
 */
import type { SearchProvider } from '../agent-core/search/provider'
import { catalogHits } from '../search/catalog-hybrid'
import { SKILLS_COLLECTION } from './semantic'
import { settingsEntityUiUri } from '@localixai/mini-app-sdk/navigation'

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
      return catalogHits(query, {
        collection: SKILLS_COLLECTION,
        rows,
        nameOf: (s) => s.name,
        fields: (s) => [s.name, s.description],
        hit: (s, score) => ({
          id: settingsEntityUiUri('skills', 'skill', s.name, query.projectId ?? ''),
          domain: 'skills',
          title: s.name,
          subtitle: s.description,
          icon: 'skill',
          score,
        }),
      })
    },
  }
}
