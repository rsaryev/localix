import { projectSettingsSchema, type ProjectSettings } from '../projects/contracts'
import { agentSettingsSchema, type AgentSettings } from '../user/contracts'

/** The persisted settings-envelope format understood by this resolver. */
export const EFFECTIVE_CONFIG_SCHEMA_VERSION = 1 as const

export type ConfigSource = 'default' | 'user' | 'project' | 'merged'

export interface EffectiveConfigDefaults {
  contextExclusions?: string[]
}

export interface ConfigMigrationSuccess<T> {
  ok: true
  value: T
  fromVersion: number
  toVersion: typeof EFFECTIVE_CONFIG_SCHEMA_VERSION
}

export interface ConfigMigrationFailure {
  ok: false
  issues: string[]
}

export type ConfigMigration<T> = ConfigMigrationSuccess<T> | ConfigMigrationFailure

export type EffectiveAgentConfig = {
  schemaVersion: typeof EFFECTIVE_CONFIG_SCHEMA_VERSION
  /** The resolved settings; project fields override user fields where applicable. */
  settings: AgentSettings & ProjectSettings
  /** Source attribution for every field with cross-scope or default resolution. */
  provenance: {
    customSystemPrompt: ConfigSource
    modelId: ConfigSource
    providerConnectionId: ConfigSource
    contextExclusions: ConfigSource
  }
  /** Non-fatal invalid/future persisted settings discovered while resolving. */
  diagnostics: string[]
}

function migrationInput(
  input: unknown,
  label: string,
): { ok: true; value: Record<string, unknown>; fromVersion: number } | ConfigMigrationFailure {
  if (input == null) return { ok: true, value: {}, fromVersion: 0 }
  if (typeof input !== 'object' || Array.isArray(input))
    return { ok: false, issues: [`${label} settings must be an object`] }

  const version =
    'schemaVersion' in input ? (input as { schemaVersion?: unknown }).schemaVersion : 0
  if (version !== 0 && version !== EFFECTIVE_CONFIG_SCHEMA_VERSION) {
    return {
      ok: false,
      issues: [`${label} settings schemaVersion must be 0 or ${EFFECTIVE_CONFIG_SCHEMA_VERSION}`],
    }
  }

  return {
    ok: true,
    value: { ...input, schemaVersion: EFFECTIVE_CONFIG_SCHEMA_VERSION },
    fromVersion: version,
  }
}

/** Migrate and validate a user settings blob without mutating persisted data. */
export function migrateAgentSettings(input: unknown): ConfigMigration<AgentSettings> {
  const migration = migrationInput(input, 'user')
  if (!migration.ok) return migration
  const parsed = agentSettingsSchema.safeParse(migration.value)
  if (!parsed.success)
    return {
      ok: false,
      issues: parsed.error.issues.map(
        (issue) => `user settings ${issue.path.join('.') || 'value'}: ${issue.message}`,
      ),
    }
  return {
    ok: true,
    value: parsed.data,
    fromVersion: migration.fromVersion,
    toVersion: EFFECTIVE_CONFIG_SCHEMA_VERSION,
  }
}

/** Migrate and validate a project settings blob without mutating persisted data. */
export function migrateProjectSettings(input: unknown): ConfigMigration<ProjectSettings> {
  const migration = migrationInput(input, 'project')
  if (!migration.ok) return migration
  const parsed = projectSettingsSchema.safeParse(migration.value)
  if (!parsed.success)
    return {
      ok: false,
      issues: parsed.error.issues.map(
        (issue) => `project settings ${issue.path.join('.') || 'value'}: ${issue.message}`,
      ),
    }
  return {
    ok: true,
    value: parsed.data,
    fromVersion: migration.fromVersion,
    toVersion: EFFECTIVE_CONFIG_SCHEMA_VERSION,
  }
}

/**
 * Resolve user/project agent settings deterministically. This is intentionally pure:
 * callers own storage, reloads, and staged migration writes.
 */
export function resolveEffectiveAgentConfig(input: {
  userSettings?: unknown
  projectSettings?: unknown
  defaults?: EffectiveConfigDefaults
  /** True when resolving a concrete project. Capability policy never inherits
   * from the independent no-project user scope. */
  projectScoped?: boolean
}): EffectiveAgentConfig {
  const userMigration = migrateAgentSettings(input.userSettings)
  const projectMigration = migrateProjectSettings(input.projectSettings)
  const diagnostics = [
    ...(userMigration.ok ? [] : userMigration.issues),
    ...(projectMigration.ok ? [] : projectMigration.issues),
  ]
  const user: AgentSettings = userMigration.ok ? userMigration.value : {}
  const project: ProjectSettings = projectMigration.ok ? projectMigration.value : {}
  const defaults = input.defaults ?? {}

  // What a scope may USE is no longer resolved here: it lives in `capability_policy` and is
  // answered by `features/capabilities/resolve.ts`, which the run pipeline and the settings
  // screen both call. This resolver keeps the settings that are genuinely user/project
  // preferences — prompts, models, context exclusions — where a project OVERRIDES a user
  // value rather than subtracting from it.
  const userContextExclusions = user.contextExclusions ?? []
  const projectContextExclusions = project.contextExclusions ?? []
  const contextExclusions = [
    ...new Set([
      ...(defaults.contextExclusions ?? []),
      ...userContextExclusions,
      ...projectContextExclusions,
    ]),
  ]

  return {
    schemaVersion: EFFECTIVE_CONFIG_SCHEMA_VERSION,
    settings: {
      ...user,
      ...project,
      schemaVersion: EFFECTIVE_CONFIG_SCHEMA_VERSION,
      contextExclusions,
    },
    provenance: {
      customSystemPrompt: project.customSystemPrompt === undefined ? 'default' : 'project',
      modelId: project.modelId === undefined ? 'default' : 'project',
      providerConnectionId: project.providerConnectionId === undefined ? 'default' : 'project',
      contextExclusions:
        projectContextExclusions.length &&
        (userContextExclusions.length || (defaults.contextExclusions?.length ?? 0))
          ? 'merged'
          : projectContextExclusions.length
            ? 'project'
            : userContextExclusions.length
              ? 'user'
              : (defaults.contextExclusions?.length ?? 0)
                ? 'default'
                : 'default',
    },
    diagnostics,
  }
}
