/**
 * SKILLS search provider (agent-core search) — matches skill name + description over
 * the discovered skills. Every hit addresses one row in its exact project scope.
 */
import type { SearchProvider } from '@localixai/mini-app-sdk/backend'
import { catalogHits } from '../search/catalog-hybrid'
import { SKILLS_COLLECTION } from './semantic'
import { capabilityUiUri } from '@localixai/mini-app-sdk/navigation'

export interface SkillSearchRow {
  name: string
  description: string
  /** The project a project-scoped item belongs to; empty or absent for a personal one. */
  projectId?: string | null
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
          id: capabilityUiUri({ kind: 'skill', id: s.name, scope: s.projectId ?? '' }),
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
