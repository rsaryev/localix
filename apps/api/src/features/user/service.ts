import { InvalidRequestError } from '../../lib/domain-errors'
import type { Kysely, Updateable } from 'kysely'
import type { AppDatabase, UserProfilesTable } from '../../db/types'
import { createUserProfileRepository, type UserProfileRow } from './repository'
import {
  agentSettingsSchema,
  normalizeAgentSettings,
  normalizeUiSettings,
  type AgentSettings,
  type AgentSettingsPatch,
  type UserProfile,
  type UpdateUserProfileRequest,
  type UiSettings,
  type UiSettingsPatch,
  uiSettingsSchema,
} from './contracts'
import { safeJsonParse } from '../../lib/json'
import { createKeyedSerializer } from '../../lib/keyed-serializer'
import {
  isAgentSettingsWithinIngressBudget,
  isUiSettingsWithinIngressBudget,
} from './profile-limits'
import { createViewStateService } from './view-state-service'

export interface UserServiceDeps {
  db: Kysely<AppDatabase>
  now?: () => string
}

function rowToProfile(row: UserProfileRow): UserProfile {
  return {
    userId: row.user_id,
    uiSettings: normalizeUiSettings(safeJsonParse<unknown>(row.ui_settings)),
    agentSettings: normalizeAgentSettings(safeJsonParse<unknown>(row.agent_settings)),
    updatedAt: row.updated_at,
  }
}

const EMPTY_PROFILE: Omit<UserProfile, 'userId' | 'updatedAt'> = {
  uiSettings: null,
  agentSettings: null,
}

export function createUserService(deps: UserServiceDeps) {
  const now = deps.now ?? (() => new Date().toISOString())
  const repo = createUserProfileRepository(deps.db)
  const serializeUpdate = createKeyedSerializer()

  const applyAgentSettingsPatch = (
    current: AgentSettings | null,
    patch: AgentSettingsPatch,
  ): AgentSettings => {
    const next: Record<string, unknown> = { ...current }
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) delete next[key]
      else if (value !== undefined) next[key] = value
    }
    const parsed = agentSettingsSchema.safeParse(next)
    if (!parsed.success || !isAgentSettingsWithinIngressBudget(parsed.data)) {
      throw new InvalidRequestError(
        'agent_settings_invalid',
        'Merged agent settings are invalid or exceed the serialized size limit.',
      )
    }
    return parsed.data
  }

  const applyUiSettingsPatch = (current: UiSettings | null, patch: UiSettingsPatch): UiSettings => {
    const next: Record<string, unknown> = { ...current }
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) delete next[key]
      else if (value !== undefined) next[key] = value
    }
    const parsed = uiSettingsSchema.safeParse(next)
    if (!parsed.success || !isUiSettingsWithinIngressBudget(parsed.data)) {
      throw new InvalidRequestError(
        'ui_settings_invalid',
        'Merged UI settings are invalid or exceed the serialized size limit.',
      )
    }
    return parsed.data
  }

  const getProfile = async (userId: string): Promise<UserProfile> => {
    const row = await repo.getRaw(userId)
    if (!row) {
      return { ...EMPTY_PROFILE, userId, updatedAt: now() }
    }
    return rowToProfile(row)
  }

  return {
    getProfile,
    ...createViewStateService(deps.db, now),

    async updateProfile(userId: string, patch: UpdateUserProfileRequest): Promise<UserProfile> {
      return serializeUpdate(userId, async () => {
        const current =
          patch.uiSettingsPatch !== undefined || patch.agentSettingsPatch !== undefined
            ? await getProfile(userId)
            : undefined
        const uiSettings =
          patch.uiSettings !== undefined
            ? patch.uiSettings
            : patch.uiSettingsPatch !== undefined
              ? applyUiSettingsPatch(current?.uiSettings ?? null, patch.uiSettingsPatch)
              : undefined
        const agentSettings =
          patch.agentSettings !== undefined
            ? patch.agentSettings
            : patch.agentSettingsPatch !== undefined
              ? applyAgentSettingsPatch(current?.agentSettings ?? null, patch.agentSettingsPatch)
              : undefined
        const updates: Updateable<UserProfilesTable> = { updated_at: now() }
        if (uiSettings !== undefined) updates.ui_settings = JSON.stringify(uiSettings)
        if (agentSettings !== undefined) updates.agent_settings = JSON.stringify(agentSettings)

        await repo.upsert(userId, updates)
        return getProfile(userId)
      })
    },
  }
}

export type UserService = ReturnType<typeof createUserService>
