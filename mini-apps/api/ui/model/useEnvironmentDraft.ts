/**
 * The environment editor's draft: which environment (or new one) is open, its locally edited rows
 * split into the Variables/Secrets views, and the explicit save, delete, rename and copy actions.
 */

import { useCallback, useState } from 'react'
import type {
  EnvironmentCreate,
  EnvironmentEdit,
  EnvironmentInfo,
  EnvVariable,
} from '../../backend/contracts'

export type Panel =
  | { kind: 'idle' }
  | { kind: 'new'; name: string; vars: EnvVariable[] }
  | { kind: 'edit'; name: string; vars: EnvVariable[] }

const IDLE: Panel = { kind: 'idle' }

const errorMessage = (err: unknown) =>
  err instanceof Error ? err.message : 'Something went wrong. Try again.'

export function useEnvironmentDraft({
  environments,
  onError,
  onCreate,
  onUpdate,
  onRemove,
  onRename,
  onDuplicate,
}: {
  environments: EnvironmentInfo[]
  onError: (message: string | null) => void
  onCreate: (input: EnvironmentCreate) => Promise<EnvironmentInfo>
  onUpdate: (name: string, edit: EnvironmentEdit) => Promise<EnvironmentInfo>
  onRemove: (name: string) => Promise<void>
  onRename: (name: string, to: string) => Promise<EnvironmentInfo>
  onDuplicate: (name: string) => Promise<EnvironmentInfo>
}) {
  const [openPanel, setPanel] = useState<Panel>(IDLE)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [variableTab, setVariableTab] = useState<'variables' | 'secrets'>('variables')
  const [renameDraft, setRenameDraft] = useState<string | null>(null)

  // If the environment being edited is deleted out from under us (agent, another tab), fall back
  // to the idle prompt rather than editing a ghost.
  const gone = openPanel.kind === 'edit' && !environments.some((e) => e.name === openPanel.name)
  if (gone) setPanel(IDLE)
  const panel = gone ? IDLE : openPanel

  const startNew = useCallback(() => {
    onError(null)
    setVariableTab('variables')
    setPanel({ kind: 'new', name: '', vars: [] })
    setRenameDraft(null)
  }, [onError])

  const startEdit = useCallback(
    (env: EnvironmentInfo) => {
      onError(null)
      setVariableTab('variables')
      // Copy the rows — the draft is edited freely and only committed on Save.
      setPanel({ kind: 'edit', name: env.name, vars: env.variables.map((v) => ({ ...v })) })
      setRenameDraft(null)
    },
    [onError],
  )

  const setVars = useCallback((vars: EnvVariable[]) => {
    setPanel((p) => (p.kind === 'idle' ? p : { ...p, vars }))
  }, [])

  const visibleVars =
    panel.kind === 'idle'
      ? []
      : panel.vars.filter((variable) =>
          variableTab === 'secrets' ? variable.secret === true : variable.secret !== true,
        )
  const setVisibleVars = useCallback(
    (next: EnvVariable[]) => {
      if (panel.kind === 'idle') return
      const other = panel.vars.filter((variable) =>
        variableTab === 'secrets' ? variable.secret !== true : variable.secret === true,
      )
      const normalized = next.map((variable) =>
        variableTab === 'secrets'
          ? { ...variable, secret: true as const }
          : {
              name: variable.name,
              value: variable.value,
              ...(variable.disabled ? { disabled: true } : {}),
            },
      )
      setVars(variableTab === 'secrets' ? [...other, ...normalized] : [...normalized, ...other])
    },
    [panel, setVars, variableTab],
  )

  const canSave = panel.kind === 'edit' || (panel.kind === 'new' && panel.name.trim().length > 0)

  const save = useCallback(async () => {
    if (panel.kind === 'idle' || saving) return
    // Drop fully-empty rows — a blank name/value pair is scaffolding, not a variable.
    const variables = panel.vars.filter((v) => v.name.trim() !== '' || v.value.trim() !== '')
    setSaving(true)
    onError(null)
    try {
      if (panel.kind === 'new') {
        const created = await onCreate({ name: panel.name.trim(), variables })
        setPanel({
          kind: 'edit',
          name: created.name,
          vars: created.variables.map((v) => ({ ...v })),
        })
      } else {
        const updated = await onUpdate(panel.name, { variables })
        setPanel({
          kind: 'edit',
          name: updated.name,
          vars: updated.variables.map((v) => ({ ...v })),
        })
      }
    } catch (err) {
      onError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }, [panel, saving, onCreate, onUpdate, onError])

  const doRemove = useCallback(async () => {
    if (panel.kind !== 'edit') return
    setConfirmDelete(false)
    onError(null)
    try {
      await onRemove(panel.name)
      setPanel({ kind: 'idle' })
    } catch (err) {
      onError(errorMessage(err))
    }
  }, [panel, onRemove, onError])

  const rename = useCallback(async () => {
    if (panel.kind !== 'edit' || renameDraft === null || saving) return
    const to = renameDraft.trim()
    if (to === panel.name) {
      setRenameDraft(null)
      return
    }
    if (to === '') return
    setSaving(true)
    onError(null)
    try {
      const moved = await onRename(panel.name, to)
      setPanel({
        kind: 'edit',
        name: moved.name,
        vars: moved.variables.map((variable) => ({ ...variable })),
      })
      setRenameDraft(null)
    } catch (err) {
      onError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }, [onRename, onError, panel, renameDraft, saving])

  const duplicate = useCallback(async () => {
    if (panel.kind !== 'edit' || saving) return
    setSaving(true)
    onError(null)
    try {
      const copied = await onDuplicate(panel.name)
      setPanel({
        kind: 'edit',
        name: copied.name,
        vars: copied.variables.map((variable) => ({ ...variable })),
      })
      setRenameDraft(null)
    } catch (err) {
      onError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }, [onDuplicate, onError, panel, saving])

  return {
    panel,
    setPanel,
    saving,
    confirmDelete,
    setConfirmDelete,
    variableTab,
    setVariableTab,
    renameDraft,
    setRenameDraft,
    startNew,
    startEdit,
    visibleVars,
    setVisibleVars,
    canSave,
    save,
    doRemove,
    rename,
    duplicate,
  }
}
