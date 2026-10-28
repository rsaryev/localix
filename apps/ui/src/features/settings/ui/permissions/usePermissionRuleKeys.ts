import { useState } from 'react'
import type { CapabilityRule } from '@/shared/api/contracts'
import { reconcilePermissionRuleKeys, type PermissionRuleKeyEntry } from './permissionRuleRows'

/**
 * The rules with the DOM key each row keeps across edits and reorders.
 *
 * The keys given last render are state: a new set is stored while rendering, the moment the
 * rules no longer match them, so the very render that sees new rules already uses their keys.
 */
export function usePermissionRuleKeys(rules: CapabilityRule[]) {
  const [keyed, setKeyed] = useState<{ entries: PermissionRuleKeyEntry[]; nextKey: number }>({
    entries: [],
    nextKey: 1,
  })
  const reconciled = reconcilePermissionRuleKeys(keyed.entries, rules, keyed.nextKey)
  const settled =
    reconciled.nextKey === keyed.nextKey &&
    reconciled.entries.length === keyed.entries.length &&
    reconciled.entries.every(
      (entry, i) => entry.key === keyed.entries[i]!.key && entry.rule === keyed.entries[i]!.rule,
    )
  if (!settled) setKeyed(reconciled)
  return reconciled
}
