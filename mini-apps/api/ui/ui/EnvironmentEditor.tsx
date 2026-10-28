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

import type { ReactNode } from 'react'
import { Layers, Plus, Trash2, X } from 'lucide-react'
import { ConfirmDialog } from '@localixai/kit/confirm-dialog'
import { Button } from '@localixai/kit/button'
import { EmptyHint } from '@localixai/kit/empty-hint'
import { IconButton } from '@localixai/kit/icon-button'
import { PanelHeader } from '@localixai/kit/panel-header'
import { StateNotice } from '@localixai/kit/state-notice'
import { WorkbenchListRowTrigger } from '@localixai/kit/workbench-list-row'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import type { EnvironmentCreate, EnvironmentEdit, EnvironmentInfo } from '../../backend/contracts'
import { useEnvironmentDraft } from '../model/useEnvironmentDraft'
import { EnvironmentNameRow } from './EnvironmentNameRow'
import { EnvironmentVariables } from './EnvironmentVariables'

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
  const {
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
  } = useEnvironmentDraft({
    environments,
    onError,
    onCreate,
    onUpdate,
    onRemove,
    onRename,
    onDuplicate,
  })

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
              <Button type="button" variant="ghost" size="sm" onClick={startNew}>
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
                    <EnvironmentNameRow
                      panel={panel}
                      setPanel={setPanel}
                      renameDraft={renameDraft}
                      setRenameDraft={setRenameDraft}
                      saving={saving}
                      rename={rename}
                      duplicate={duplicate}
                    />

                    <EnvironmentVariables
                      vars={panel.vars}
                      variableTab={variableTab}
                      setVariableTab={setVariableTab}
                      visibleVars={visibleVars}
                      setVisibleVars={setVisibleVars}
                    />
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
                variant="ghost"
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
                      variant="ghost"
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
