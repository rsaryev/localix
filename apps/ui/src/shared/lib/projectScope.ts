import type { LucideIcon } from 'lucide-react'
import { NO_PROJECT, PROJECT_ICON } from '@/shared/ui/projectPresentation'

/**
 * Builds the `<Select>` option list for a scope picker: a leading no-project
 * sentinel followed by one option per project. Shared by the settings panels
 * (MCP/Skills) and plugin create forms so the projects-to-options mapping
 * lives in exactly one place. Label and icon come from the shared project
 * presentation, so "No project" reads the same here as in every other list.
 */
export interface ScopeOption {
  value: string
  label: string
  icon?: LucideIcon
}

export function buildProjectScopeOptions(
  projects: ReadonlyArray<{ id: string; name: string }>,
  noProject: ScopeOption = { value: '', label: NO_PROJECT.label, icon: NO_PROJECT.icon },
): ScopeOption[] {
  return [noProject, ...projects.map((p) => ({ value: p.id, label: p.name, icon: PROJECT_ICON }))]
}

/**
 * Human label for an entity's project scope: "No project" when it has no project,
 * otherwise the project's name (falling back to `'Project'` if the id is unknown).
 * Used by the settings badges (plugins / mcp / agents) so the lookup
 * lives in one place.
 */
export function projectScopeLabel(
  projects: ReadonlyArray<{ id: string; name: string }>,
  projectId: string | null | undefined,
): string {
  if (!projectId) return NO_PROJECT.label
  return projects.find((p) => p.id === projectId)?.name ?? 'Project'
}
