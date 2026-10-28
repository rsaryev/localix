import { useCallback, useEffect, useRef, useState } from 'react'
import { backendClient } from '@/shared/api/client'
import type { CapabilityRule } from '@/shared/api/contracts'
import { parseCapabilityScope } from '@/shared/api/capabilityScope'
import { inlineFailure } from '@/shared/lib/notifications/inlineReport'
import { invalidateCapabilities } from '@/shared/contrib/capabilityCache'
import { trackCapabilityWrite } from '@/shared/contrib/capabilityWrites'
import { sameRules } from '../ui/permissions/ruleDefaults'

export interface PermissionRulesData {
  /** The list being edited. Local until `apply`. */
  rules: CapabilityRule[]
  /** The shipped list for a role the product owns; null for every scope the user owns. */
  defaults: CapabilityRule[] | null
  /** Whether the edited list differs from the one last read or written. */
  dirty: boolean
  saving: boolean
  loading: boolean
  loadError: string | null
  saveError: string | null
  /** Whether Reset would change anything — a control that does nothing reads as broken. */
  resettable: boolean
  edit: (next: CapabilityRule[]) => void
  /** Stage the shipped rules. Nothing is written until `apply`. */
  stageDefaults: () => void
  apply: () => Promise<void>
  /** Throw the local edits away and re-read what is stored. */
  discard: () => void
}

/**
 * One scope's own permission rules: read, edit, apply.
 *
 * WHY EXPLICIT APPLY. This used to save 300 ms after every keystroke, and a rule field is
 * typed one character at a time — so `tool:ba` was persisted on the way to `tool:Bash`, and
 * for a moment the stored policy said something nobody meant. The debounce then needed a
 * save chain, an edit epoch, a dirty ref and a rule that a reload must not clobber an
 * in-flight write, all to make a half-typed rule land safely. An Apply button is the same
 * guarantee with none of the machinery, and it is what the rest of this screen already does.
 *
 * The revision check is untouched: a save carries the revision it read, and the server
 * refuses to land on top of a newer one rather than silently winning.
 */
export function usePermissionRules(scope: string, active: boolean): PermissionRulesData {
  const [rules, setRules] = useState<CapabilityRule[]>([])
  const [stored, setStored] = useState<CapabilityRule[]>([])
  const [defaults, setDefaults] = useState<CapabilityRule[] | null>(null)
  // `loading` is derived: a read is in flight from the moment the effect starts it until it
  // settles, and its cleanup clears the mark, so a restarted read shows as loading again.
  const [settled, setSettled] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  const revision = useRef<number | null>(null)

  useEffect(() => {
    // A parked Settings tab stays mounted. Reading on mount would put one request per warm
    // surface on the wire every time the panel is built.
    if (!active) return
    let cancelled = false
    void backendClient
      .fetchCapabilityRules(parseCapabilityScope(scope))
      .then((loaded) => {
        if (cancelled) return
        setRules(loaded.rules)
        setStored(loaded.rules)
        revision.current = loaded.revision
        setDefaults(loaded.defaults ?? null)
        setLoadError(null)
      })
      // Stated, not floating. An unhandled rejection here used to surface as a bare console
      // error with no bearing on the screen, which reads as "there are no rules" — the one
      // wrong thing a permissions editor can say.
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(inlineFailure(error, 'Could not load the rules.'))
      })
      .finally(() => {
        if (!cancelled) setSettled(true)
      })
    return () => {
      cancelled = true
      setSettled(false)
    }
  }, [scope, active, reload])
  const loading = active && !settled

  const edit = useCallback((next: CapabilityRule[]) => {
    setRules(next)
    setSaveError(null)
  }, [])

  const apply = useCallback(async () => {
    if (revision.current === null) {
      setSaveError('Reload the rules before applying.')
      return
    }
    setSaving(true)
    setSaveError(null)
    try {
      const expectedPolicyRevision = revision.current
      await trackCapabilityWrite(undefined, async () => {
        const saved = await backendClient.saveCapabilityRules(
          rules,
          expectedPolicyRevision,
          parseCapabilityScope(scope),
        )
        revision.current = saved.revision
        invalidateCapabilities(scope)
      })
      setStored(rules)
    } catch (error) {
      // A failed or lost response cannot establish a new base for a later save.
      revision.current = null
      setSaveError(inlineFailure(error, 'Could not save the permission rules.'))
    } finally {
      setSaving(false)
    }
  }, [rules, scope])

  const discard = useCallback(() => {
    setSaveError(null)
    setLoadError(null)
    revision.current = null
    setReload((value) => value + 1)
  }, [])

  const stageDefaults = useCallback(() => {
    if (defaults) edit(defaults)
  }, [defaults, edit])

  return {
    rules,
    defaults,
    dirty: !sameRules(rules, stored),
    saving,
    loading,
    loadError,
    saveError,
    resettable: defaults !== null && !sameRules(rules, defaults),
    edit,
    stageDefaults,
    apply,
    discard,
  }
}
