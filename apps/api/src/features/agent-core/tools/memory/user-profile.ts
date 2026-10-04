import type { UserProfileRepository, UserProfileRow } from '../../../user/repository'
import { normalizeAgentSettings, type AgentSettings } from '../../../user/contracts'
import { USER_PROFILE_PROMPT_MAX_CHARS } from '../../../user/profile-limits'
import { formatUsage, usageOf } from '../../../memory/file-store'

/** Combined soft cap across name/role/expertise/preferences/working_context/experience/use-case. */
export const PROFILE_CHAR_LIMIT = USER_PROFILE_PROMPT_MAX_CHARS

/** The single source of truth for what the budget counts. */
const PROFILE_TEXT_FIELDS = [
  'name',
  'role',
  'expertise',
  'preferences',
  'working_context',
  'experience_level',
  'main_use_case',
] as const
type ProfileTextField = (typeof PROFILE_TEXT_FIELDS)[number]

/** Slugs ("write-code", "mid") read better in the prompt as plain words. */
const humanizeSlug = (slug: string): string => slug.replace(/[-_]/g, ' ')

function profileChars(
  fields: Partial<Record<ProfileTextField, string | null | undefined>>,
): number {
  return PROFILE_TEXT_FIELDS.reduce((sum, f) => sum + (fields[f]?.length ?? 0), 0)
}

function formatProfile(row: UserProfileRow): string {
  const lines: string[] = []
  if (row.name) lines.push(`Name: ${row.name}`)
  if (row.role) lines.push(`Role: ${row.role}`)
  if (row.expertise) {
    try {
      const arr = JSON.parse(row.expertise) as string[]
      lines.push(`Expertise: ${arr.join(', ')}`)
    } catch {
      lines.push(`Expertise: ${row.expertise}`)
    }
  }
  if (row.preferences) {
    try {
      const obj = JSON.parse(row.preferences) as Record<string, unknown>
      const entries = Object.entries(obj)
        .map(([k, v]) => `  ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
        .join('\n')
      lines.push(`Preferences:\n${entries}`)
    } catch {
      lines.push(`Preferences: ${row.preferences}`)
    }
  }
  if (row.working_context) lines.push(`Working context: ${row.working_context}`)
  if (row.experience_level) lines.push(`Experience: ${humanizeSlug(row.experience_level)}`)
  if (row.main_use_case) lines.push(`Main use case: ${humanizeSlug(row.main_use_case)}`)
  if (lines.length === 0) return 'No profile yet.'
  lines.push(`(usage: ${formatUsage(usageOf(profileChars(row), PROFILE_CHAR_LIMIT))})`)
  return lines.join('\n')
}

export async function loadUserProfile(
  repo: UserProfileRepository,
  userId: string,
): Promise<string | null> {
  return (await loadUserProfileContext(repo, userId)).profileText
}

export interface UserProfileContext {
  /** Formatted profile text for the system prompt, or null when empty. */
  profileText: string | null
  /** Raw response_defaults column, or undefined; prompt assembly applies the stable-prefix cap. */
  responseDefaults: string | undefined
  /** Schema-normalized agent_settings, or null when absent/invalid. */
  agentSettings: AgentSettings | null
}

/**
 * Single-query loader for everything the runner needs from user_profiles:
 * the formatted profile text, response defaults, and parsed agent settings.
 */
export async function loadUserProfileContext(
  repo: UserProfileRepository,
  userId: string,
): Promise<UserProfileContext> {
  const row = await repo.getRaw(userId)
  if (!row) return { profileText: null, responseDefaults: undefined, agentSettings: null }

  const formatted = formatProfile(row)
  let agentSettings: AgentSettings | null = null
  if (row.agent_settings) {
    try {
      agentSettings = normalizeAgentSettings(JSON.parse(row.agent_settings) as unknown)
    } catch (err) {
      // Falling back to defaults is right — a run must not die on one bad column — but
      // it is invisible from the outside: Settings keeps showing the stored value while
      // every run ignores it. Name the row so the mismatch is explicable.
      console.warn(`[user-profile] agent_settings for ${userId} is unreadable; using defaults`, err)
    }
  }
  return {
    profileText: formatted === 'No profile yet.' ? null : formatted,
    responseDefaults: row.response_defaults ?? undefined,
    agentSettings,
  }
}
