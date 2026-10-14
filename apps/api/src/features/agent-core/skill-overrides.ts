/**
 * Skill visibility, as every invocation surface reads it.
 *
 * One value, because there is one question. It used to also carry `name-only` and
 * `user-invocable-only` — narrowings of how the model SEES a skill that is on — but no
 * surface could set them: they were reachable only by hand-editing a settings document that
 * no longer exists. Availability is now a capability verdict like any other, so what is left
 * here is the projection of that verdict into the shape these surfaces already take.
 */
export type SkillOverride = 'off'

export type SkillOverrides = Readonly<Record<string, SkillOverride | undefined>>

/** `off` is stronger than prompt visibility: the skill must not be invocable. */
export function isSkillDisabled(overrides: SkillOverrides, name: string): boolean {
  return overrides[name] === 'off'
}

/** Preserve discovery order while removing skills disabled by user policy. */
export function filterDisabledSkills<T extends { name: string }>(
  skills: readonly T[],
  overrides: SkillOverrides,
): T[] {
  return skills.filter((skill) => !isSkillDisabled(overrides, skill.name))
}

/** Stable marker used to make next-run visibility changes bypass a frozen roster. */
export function skillOverridesRevision(overrides: SkillOverrides): string | undefined {
  const entries = Object.entries(overrides).sort(([left], [right]) => left.localeCompare(right))
  return entries.length === 0 ? undefined : JSON.stringify(entries)
}
