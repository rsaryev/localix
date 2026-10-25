import type { CapabilityRule } from '@/shared/api/contracts'

type PermissionAction = CapabilityRule['effect']

/**
 * The ONE place the effect vocabulary is coloured. Keyed on the owner's union, so it is
 * exhaustive: add an effect upstream and this literal fails to compile until it gets a
 * colour. As a plain `Record<string, string>` it could notice neither a new effect nor a
 * typo'd key — the lookup would just miss and `cn()` would swallow the `undefined`,
 * rendering the rule with no colour at all.
 *
 * Shared by the editor and its legend, which is why it is not inside either.
 */
export const ACTION_COLORS: Record<PermissionAction, string> = {
  allow: 'text-status-success',
  deny: 'text-status-error',
  ask: 'text-status-warning',
}

/** Derived from the record above — a second hand-written list would be a second place to
 *  forget. A new effect now reaches the picker for free. */
export const ACTION_OPTIONS = (Object.keys(ACTION_COLORS) as PermissionAction[]).map((a) => ({
  value: a,
  label: a,
}))

/**
 * The effect picker's options, each carrying what the server's grammar says it does.
 *
 * That meaning sat in a legend paragraph below the rules, away from the field where the effect is
 * chosen, so picking one meant reading elsewhere first. It is the option's own line now.
 */
export function effectOptions(
  effects: ReadonlyArray<{ value: string; hint: string }>,
): Array<{ value: PermissionAction; label: string; description?: string }> {
  return ACTION_OPTIONS.map((option) => ({
    ...option,
    description: effects.find((effect) => effect.value === option.value)?.hint,
  }))
}
