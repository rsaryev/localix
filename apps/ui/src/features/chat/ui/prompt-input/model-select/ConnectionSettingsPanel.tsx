import type { ReactNode } from 'react'
import { ArrowLeft, Plus, TriangleAlert } from 'lucide-react'
import { Button } from '@localixai/kit/button'
import { Input } from '@localixai/kit/input'
import { PanelHeader } from '@localixai/kit/panel-header'
import { SectionLabel } from '@localixai/kit/section-label'
import { StatusDot } from '@localixai/kit/status-dot'
import { WorkbenchNoticeBar } from '@localixai/kit/workbench-notice-bar'
import { toast } from '@/shared/lib/notify'
import { errorMessage } from '@localixai/plugin-sdk/ui/utilities'
import type { ProviderConnection } from '@/shared/api/contracts'
import type { ProviderEntry } from '@localixai/agent/catalog'
import { ConnectionKeysPanel } from './ConnectionKeysPanel'
import { PickerPanelTitle } from './PickerPanelTitle'
import type { SelectedItem } from './ModelSelectSidebar'
import type { useConnections } from '../useConnections'

type ConnectionsState = ReturnType<typeof useConnections>

export function UnreadableCredentialNotice() {
  return (
    <WorkbenchNoticeBar
      role="status"
      tone="warning"
      icon={<TriangleAlert />}
      title="Credential unavailable"
      description="The rest of the workspace is still available. Add a new key below or remove this connection."
    />
  )
}

export function ConnectionAuthStatus({
  authType,
  credentialAvailable,
}: {
  authType: ProviderConnection['authType']
  credentialAvailable: boolean
}) {
  const method = authType === 'oauth-pkce' ? 'OAuth' : 'API key'
  const label = credentialAvailable ? `${method} connected` : `${method} unavailable`

  return (
    <div className="flex min-h-8 items-center justify-between gap-3 border-y border-border-faint py-1.5">
      <span className="text-xs text-text-soft">Authentication</span>
      <span className="inline-flex min-w-0 items-center gap-1.5 text-xs text-foreground">
        <StatusDot
          className={credentialAvailable ? 'bg-status-success' : 'bg-status-warning'}
          label={label}
        />
        <span className="truncate">{label}</span>
      </span>
    </div>
  )
}

interface ConnectionSettingsPanelProps {
  /** The narrow layout's workload/provider switcher; it takes the title's place below md. */
  nav?: ReactNode
  connection: ProviderConnection
  connections: ProviderConnection[]
  allProviders: ProviderEntry[]
  renameLabel: string
  setRenameLabel: (label: string) => void
  updateLabel: ConnectionsState['updateLabel']
  addKey: ConnectionsState['addKey']
  removeKey: ConnectionsState['removeKey']
  updateKey: ConnectionsState['updateKey']
  remove: ConnectionsState['remove']
  onExitEdit: () => void
  setSelectedItem: (item: SelectedItem) => void
}

/**
 * Right-panel settings for one connection: rename, auth-type readout, API-key
 * management, plus add-another / remove actions. Extracted verbatim from
 * ModelSearchSelect — the parent keeps the `editMode` guard.
 */
export function ConnectionSettingsPanel({
  nav,
  connection: selectedConn,
  connections,
  allProviders,
  renameLabel,
  setRenameLabel,
  updateLabel,
  addKey,
  removeKey,
  updateKey,
  remove,
  onExitEdit,
  setSelectedItem,
}: ConnectionSettingsPanelProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <PanelHeader
        tone="content"
        title={<PickerPanelTitle title={selectedConn.label} nav={nav} />}
        actionsLabel={`${selectedConn.label} settings actions`}
        actions={
          // Only a connection that HAS models has a list to go back to; an unreadable one opens
          // straight onto this panel, where "Models" would lead back here.
          selectedConn.hasApiKey ? (
            <Button variant="ghost" size="sm" onClick={onExitEdit}>
              <ArrowLeft data-icon="inline-start" />
              Models
            </Button>
          ) : undefined
        }
      />

      {/* The body sits on the header's gutter, so a field's edge lines up with the title. */}
      <div className="scrollbar-thin flex min-h-0 flex-1 flex-col overflow-y-auto px-(--workbench-gutter) py-3">
        <div className="flex flex-col gap-3">
          {!selectedConn.hasApiKey && <UnreadableCredentialNotice />}

          <div className="flex flex-col gap-1">
            <SectionLabel as="span" weight="semibold">
              Rename Connection
            </SectionLabel>
            <div className="flex gap-1.5">
              <Input
                type="text"
                size="lg"
                value={renameLabel}
                onChange={(e) => setRenameLabel(e.target.value)}
                placeholder="Connection label"
                className="flex-1"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const v = renameLabel.trim()
                    if (v && v !== selectedConn.label)
                      updateLabel(selectedConn.id, v).catch((error) => {
                        toast.error('Could not rename this connection', {
                          description: errorMessage(error, '') || undefined,
                        })
                      })
                  }
                }}
              />
              <Button
                variant="mono"
                size="lg"
                onClick={() => {
                  const v = renameLabel.trim()
                  if (v && v !== selectedConn.label)
                    updateLabel(selectedConn.id, v).catch((error) => {
                      toast.error('Could not rename this connection', {
                        description: errorMessage(error, '') || undefined,
                      })
                    })
                }}
                className="rounded-lg px-3 font-semibold shrink-0"
              >
                Save
              </Button>
            </div>
          </div>

          <ConnectionAuthStatus
            authType={selectedConn.authType}
            credentialAvailable={selectedConn.hasApiKey}
          />

          <ConnectionKeysPanel
            connection={selectedConn}
            onAddKey={addKey}
            onRemoveKey={removeKey}
            onUpdateKey={updateKey}
          />
        </div>

        <div className="mt-auto flex flex-col gap-1.5 pt-4">
          <Button
            variant="outline"
            size="lg"
            onClick={() => setSelectedItem({ type: 'provider', id: selectedConn.providerId })}
            className="w-full"
          >
            <Plus data-icon="inline-start" />
            Add another {selectedConn.providerName} connection
          </Button>
          <Button
            variant="destructive"
            size="lg"
            onClick={() => {
              remove(selectedConn.id).catch((error) => {
                toast.error('Could not remove this connection', {
                  description: errorMessage(error, '') || undefined,
                })
              })
              const remaining = connections.filter((c) => c.id !== selectedConn.id)
              if (remaining.length > 0) setSelectedItem({ type: 'connection', id: remaining[0].id })
              else if (allProviders.length > 0)
                setSelectedItem({ type: 'provider', id: allProviders[0].id })
              else setSelectedItem(null)
            }}
            className="w-full"
          >
            Remove connection
          </Button>
        </div>
      </div>
    </div>
  )
}
