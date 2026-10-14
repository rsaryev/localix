/**
 * Manage environments inside the API Client workspace.
 *
 * An environment is a named set of variables. Plain values remain file-native; secret rows store
 * only native-Vault references and are resolved server-side for the outgoing request.
 *
 * No autosave: a draft is held locally and written only on an explicit Save, so half-typed
 * variables never reach the store. Leaving the surface discards an unsaved draft, the same
 * contract as every other editor here. Rename and copy are explicit lifecycle actions: neither
 * rewrites nor resolves the native-Vault references held by secret rows.
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Check, Copy, KeyRound, Layers, Pencil, Plus, Trash2, X } from 'lucide-react'
import { ConfirmDialog } from '@localixai/kit/confirm-dialog'
import { Button } from '@localixai/kit/button'
import { EmptyHint } from '@localixai/kit/empty-hint'
import { Input } from '@localixai/kit/input'
import { IconButton } from '@localixai/kit/icon-button'
import { PanelHeader } from '@localixai/kit/panel-header'
import { StateNotice } from '@localixai/kit/state-notice'
import { WorkbenchToolbar } from '@localixai/kit/workbench-toolbar'
import { WorkbenchListRowTrigger } from '@localixai/kit/workbench-list-row'
import { cn } from '@localixai/plugin-sdk/ui/classes'
import type {
  EnvironmentCreate,
  EnvironmentEdit,
  EnvironmentInfo,
  EnvVariable,
} from '../../backend/contracts'
import { PairEditor } from './PairEditor'
import { SegmentedControl, SegmentedControlItem } from '@localixai/plugin-sdk/ui/segmented-control'

type Panel =
  | { kind: 'idle' }
  | { kind: 'new'; name: string; vars: EnvVariable[] }
  | { kind: 'edit'; name: string; vars: EnvVariable[] }

const errorMessage = (err: unknown) =>
  err instanceof Error ? err.message : 'Something went wrong. Try again.'

export function EnvironmentEditor({
  onClose,
  onError,
  problem,
  environments,
  onUse,
  onCreate,
  onUpdate,
  onRemove,
  onRename,
  onDuplicate,
}: {
  onClose: () => void
  /**
   * The workspace's setter for "the last action here failed". The state is held ABOVE this
   * surface because the whole editor unmounts the moment the person leaves it — usually right
   * after the failure — and a report whose owner is gone can never be settled.
   */
  onError: (message: string | null) => void
  /** The rendered line for that failure, owned by the workspace. */
  problem: ReactNode
  environments: EnvironmentInfo[]
  onUse: (name: string) => Promise<void>
  onCreate: (input: EnvironmentCreate) => Promise<EnvironmentInfo>
  onUpdate: (name: string, edit: EnvironmentEdit) => Promise<EnvironmentInfo>
  onRemove: (name: string) => Promise<void>
  onRename: (name: string, to: string) => Promise<EnvironmentInfo>
  onDuplicate: (name: string) => Promise<EnvironmentInfo>
}) {
  const [panel, setPanel] = useState<Panel>({ kind: 'idle' })
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [variableTab, setVariableTab] = useState<'variables' | 'secrets'>('variables')
  const [renameDraft, setRenameDraft] = useState<string | null>(null)

  // If the environment being edited is deleted out from under us (agent, another tab), fall back
  // to the idle prompt rather than editing a ghost.
  useEffect(() => {
    if (panel.kind === 'edit' && !environments.some((e) => e.name === panel.name)) {
      setPanel({ kind: 'idle' })
    }
  }, [environments, panel])

  const startNew = useCallback(() => {
    onError(null)
    setVariableTab('variables')
    setPanel({ kind: 'new', name: '', vars: [] })
    setRenameDraft(null)
  }, [])

  const startEdit = useCallback((env: EnvironmentInfo) => {
    onError(null)
    setVariableTab('variables')
    // Copy the rows — the draft is edited freely and only committed on Save.
    setPanel({ kind: 'edit', name: env.name, vars: env.variables.map((v) => ({ ...v })) })
    setRenameDraft(null)
  }, [])

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
  }, [panel, saving, onCreate, onUpdate])

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
  }, [panel, onRemove])

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
  }, [onRename, panel, renameDraft, saving])

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
  }, [onDuplicate, panel, saving])

  // No ground coat: this fills the workspace's main column, which already inherits the host pane's
  // ground — and under the macOS glass theme that token carries alpha, so a second pane-sized coat
  // compounds into an opaque slab.
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelHeader
        tone="content"
        title="Environments"
        summary={
          <span className="max-w-72 truncate text-2xs font-normal text-text-faint">
            Variables and Vault secrets
          </span>
        }
        actions={
          <IconButton
            size="sm"
            aria-label="Close environments"
            tooltip="Back to request"
            onClick={onClose}
          >
            <X className="size-3.5" />
          </IconButton>
        }
      />

      {/* Outside the editor column: the panel that failed to save is often the one being closed. */}
      {problem}

      <div className="flex min-h-0 flex-1">
        {environments.length === 0 && panel.kind === 'idle' ? (
          <StateNotice
            title="No environments"
            body="Create one to reuse variables across requests."
            actions={
              <Button type="button" variant="outline" size="sm" onClick={startNew}>
                <Plus className="size-3.5" />
                New environment
              </Button>
            }
          />
        ) : (
          <>
            {/* The navigator earns its column only once there is something to navigate. */}
            {environments.length > 0 && (
              <div className="flex w-44 shrink-0 flex-col border-r border-border-soft">
                <div className="flex-1 overflow-y-auto py-1">
                  {environments.map((env) => {
                    const selected = panel.kind === 'edit' && panel.name === env.name
                    return (
                      <WorkbenchListRowTrigger
                        key={env.name}
                        type="button"
                        onClick={() => startEdit(env)}
                        aria-current={selected}
                        className={cn(
                          'w-full flex-none rounded-none px-3 py-1.5 text-xs transition-colors duration-(--dur-fast)',
                          selected
                            ? 'bg-surface-active text-foreground'
                            : 'text-text-soft hover:bg-surface-hover',
                        )}
                      >
                        <Layers className="size-3.5 shrink-0 text-text-faint" />
                        <span className="min-w-0 flex-1 truncate">{env.name}</span>
                        {env.active && (
                          <span className="shrink-0 text-2xs text-text-faint">active</span>
                        )}
                      </WorkbenchListRowTrigger>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Editor column */}
            <div className="flex min-w-0 flex-1 flex-col">
              {panel.kind === 'idle' ? (
                <EmptyHint className="flex-1">
                  Select an environment to edit its variables, or create a new one.
                </EmptyHint>
              ) : (
                <>
                  <div className="flex flex-1 flex-col overflow-y-auto">
                    <div className="border-b border-border-soft px-3 py-2">
                      {panel.kind === 'new' ? (
                        <Input
                          size="lg"
                          autoFocus
                          value={panel.name}
                          placeholder="Environment name, e.g. production"
                          aria-label="Environment name"
                          onChange={(e) => setPanel({ ...panel, name: e.target.value })}
                        />
                      ) : (
                        <div className="flex min-h-7 items-center gap-1.5">
                          {renameDraft !== null ? (
                            <>
                              <Input
                                autoFocus
                                size="md"
                                aria-label={`Rename ${panel.name}`}
                                className="h-7 min-w-0 flex-1"
                                value={renameDraft}
                                onChange={(event) => setRenameDraft(event.target.value)}
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter') void rename()
                                  if (event.key === 'Escape') setRenameDraft(null)
                                }}
                              />
                              <IconButton
                                size="sm"
                                aria-label="Save environment name"
                                tooltip="Save name"
                                disabled={saving || renameDraft.trim() === ''}
                                onClick={() => void rename()}
                              >
                                <Check className="size-3.5" />
                              </IconButton>
                              <IconButton
                                size="sm"
                                aria-label="Cancel environment rename"
                                tooltip="Cancel"
                                onClick={() => setRenameDraft(null)}
                              >
                                <X className="size-3.5" />
                              </IconButton>
                            </>
                          ) : (
                            <>
                              <Layers className="size-4 shrink-0 text-text-faint" />
                              <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                                {panel.name}
                              </span>
                              <IconButton
                                size="sm"
                                aria-label={`Rename ${panel.name}`}
                                tooltip="Rename environment"
                                disabled={saving}
                                onClick={() => setRenameDraft(panel.name)}
                              >
                                <Pencil className="size-3.5" />
                              </IconButton>
                              <IconButton
                                size="sm"
                                aria-label={`Duplicate ${panel.name}`}
                                tooltip="Duplicate environment"
                                disabled={saving}
                                onClick={() => void duplicate()}
                              >
                                <Copy className="size-3.5" />
                              </IconButton>
                            </>
                          )}
                        </div>
                      )}
                    </div>

                    <WorkbenchToolbar
                      aria-label="Environment variable controls"
                      className="justify-between"
                    >
                      <SegmentedControl aria-label="Environment variable type">
                        <SegmentedControlItem
                          active={variableTab === 'variables'}
                          onClick={() => setVariableTab('variables')}
                        >
                          Variables · {panel.vars.filter((variable) => !variable.secret).length}
                        </SegmentedControlItem>
                        <SegmentedControlItem
                          active={variableTab === 'secrets'}
                          onClick={() => setVariableTab('secrets')}
                        >
                          Secrets · {panel.vars.filter((variable) => variable.secret).length}
                        </SegmentedControlItem>
                      </SegmentedControl>
                      {variableTab === 'secrets' && (
                        <span className="flex items-center gap-1.5 text-2xs text-text-faint">
                          <KeyRound className="size-3.5" />
                          Native Vault
                        </span>
                      )}
                    </WorkbenchToolbar>
                    <PairEditor
                      key={variableTab}
                      label={variableTab === 'secrets' ? 'Secrets' : 'Variables'}
                      pairs={visibleVars}
                      onChange={setVisibleVars}
                      namePlaceholder={variableTab === 'secrets' ? 'api_token' : 'base_url'}
                      valuePlaceholder={
                        variableTab === 'secrets' ? 'Vault secret' : 'https://api.example.com'
                      }
                      secretValues={variableTab === 'secrets'}
                    />
                    {variableTab === 'secrets' && (
                      <p className="px-3 pb-3 text-2xs text-text-faint">
                        Type a new value to move it into Vault, or use the key button to reuse an
                        existing secret. The literal never enters the environment file or browser
                        history.
                      </p>
                    )}
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </div>

      {(environments.length > 0 || panel.kind !== 'idle') && (
        <div
          data-slot="environment-editor-footer"
          className="flex h-12 shrink-0 items-stretch border-t border-border-soft"
        >
          {environments.length > 0 && (
            <div className="flex w-44 shrink-0 items-center border-r border-border-soft px-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full justify-center gap-1.5"
                onClick={startNew}
              >
                <Plus className="size-3.5" />
                New environment
              </Button>
            </div>
          )}
          <div className="flex min-w-0 flex-1 items-center justify-between gap-2 px-3">
            {panel.kind === 'edit' ? (
              <IconButton
                size="sm"
                tone="danger"
                aria-label={`Delete ${panel.name}`}
                tooltip="Delete environment"
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 className="size-3.5" />
              </IconButton>
            ) : (
              <span />
            )}
            {panel.kind !== 'idle' && (
              <div className="flex items-center gap-2">
                {panel.kind === 'edit' &&
                  !environments.find((environment) => environment.name === panel.name)?.active && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={saving}
                      onClick={() => void onUse(panel.name)}
                    >
                      Use environment
                    </Button>
                  )}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setPanel({ kind: 'idle' })}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="mono"
                  size="sm"
                  disabled={!canSave || saving}
                  onClick={() => void save()}
                >
                  {saving ? 'Saving…' : panel.kind === 'new' ? 'Create' : 'Save'}
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmDelete}
        title={panel.kind === 'edit' ? `Delete ${panel.name}?` : 'Delete environment?'}
        description="Its variables are removed. Requests that still reference them will not send until another active environment defines them."
        confirmLabel="Delete"
        onConfirm={() => void doRemove()}
        onClose={() => setConfirmDelete(false)}
      />
    </div>
  )
}
