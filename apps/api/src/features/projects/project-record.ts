import type { Project, ProjectSettings, ProjectSettingsPatch } from './contracts'
import { normalizeProjectSettings, projectSettingsSchema } from './contracts'
import type { ProjectRecord } from './repository'
import { safeJsonParse } from '../../lib/json'
import { isDefaultProject } from './default-project'

export const toDto = (record: ProjectRecord): Project => ({
  id: record.id,
  userId: record.userId,
  name: record.name,
  workingDir: record.workingDir,
  settings: normalizeProjectSettings(safeJsonParse<unknown>(record.settings)),
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
  // The DIRECTORY decides, exactly as `resolveDefaultProject` matches it — never the name,
  // which the user may change without changing which project this is.
  isDefault: isDefaultProject(record),
})

export function applyProjectSettingsPatch(
  current: ProjectSettings | null,
  patch: ProjectSettingsPatch,
): ProjectSettings {
  const next: Record<string, unknown> = { ...current }
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete next[key]
    else if (value !== undefined) next[key] = value
  }
  return projectSettingsSchema.parse(next)
}
