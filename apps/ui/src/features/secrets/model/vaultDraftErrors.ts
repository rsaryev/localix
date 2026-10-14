import {
  canSubmitSecret,
  secretKeyError,
  secretValueError,
} from '@/features/settings/model/secretDraft'
import type { FieldErrors } from '@/shared/lib/forms/fieldErrors'

/**
 * What the vault dialog's three modes require, and what is missing right now.
 *
 * Split out of the dialog because it is the part with rules rather than markup: which fields
 * each mode needs, and the difference between a field that is MALFORMED (the live checks in
 * `secretDraft`, which say nothing about an empty box — untouched is not wrong) and one that
 * is simply EMPTY at the moment the button is pressed. The dialog used to carry that
 * difference by greying the submit out, which named no field at all.
 */

export type VaultMode = 'create' | 'edit' | 'rotate'

/** The controls a submit can send the reader back to. */
export type VaultField = 'key' | 'value' | 'title'

/** Would the server accept this draft? Asked of the VALUES, never of a stale message. */
export function vaultDraftReady(
  mode: VaultMode,
  draft: { key: string; value: string; title: string },
): boolean {
  if (mode === 'edit') return draft.title.trim().length > 0
  if (mode === 'rotate') return draft.value.length > 0 && !secretValueError(draft.value)
  return canSubmitSecret(draft.key, draft.value)
}

/**
 * The required fields this mode has no value for, in the order they appear — which is what
 * lets the submit focus the first one (`focusFirstInvalid`).
 */
export function vaultMissingFields(
  mode: VaultMode,
  draft: { key: string; value: string; title: string },
): FieldErrors<VaultField> {
  const missing: FieldErrors<VaultField> = {}
  if (mode === 'edit' && !draft.title.trim()) missing.title = 'Required.'
  if (mode === 'create' && !draft.key) missing.key = 'Required.'
  if (mode !== 'edit' && !draft.value) missing.value = 'Required.'
  return missing
}

/** The live problem when there is one, else whatever the last submit found missing. */
export function vaultKeyProblem(
  mode: VaultMode,
  key: string,
  missing: FieldErrors<VaultField>,
): string | undefined {
  const live = mode === 'create' ? secretKeyError(key) : null
  return live ?? missing.key
}

export function vaultValueProblem(
  mode: VaultMode,
  value: string,
  missing: FieldErrors<VaultField>,
): string | undefined {
  const live = mode === 'edit' ? null : secretValueError(value)
  return live ?? missing.value
}
