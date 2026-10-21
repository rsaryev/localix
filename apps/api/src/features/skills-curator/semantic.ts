/**
 * Skills in the semantic index: their own collection, so a search for skills weighs
 * skills only. Listed whole for the workspace owner across scopes (`list-source.ts`) and
 * reconciled when the kind changes.
 */
import type { CoreRefs } from '../changes/core-entities'
import type { EntityRef } from '@localixai/change-feed'
import { catalogKey, createScopedCatalogSource } from '../embeddings/list-source'
import type { SemanticTarget } from '../embeddings/targets'
import type { SkillsCuratorService } from './service'

export const SKILLS_COLLECTION = 'capabilities.skills'

export const skillsSemanticTarget: SemanticTarget<EntityRef<CoreRefs, 'skill'>> = {
  collection: SKILLS_COLLECTION,
  keyOf: (ref) => catalogKey(ref.scope, ref.name),
}

export function createSkillsSemanticSource(deps: {
  owner: string
  projects: () => Promise<readonly string[]>
  listSkills: SkillsCuratorService['listSkills']
}) {
  return createScopedCatalogSource({
    collection: SKILLS_COLLECTION,
    label: 'Skills',
    version: 1,
    owner: deps.owner,
    projects: deps.projects,
    list: async (projectId) =>
      (await deps.listSkills(deps.owner, { projectId })).map((s) => ({
        name: s.name,
        title: s.name,
        description: s.description,
      })),
  })
}
