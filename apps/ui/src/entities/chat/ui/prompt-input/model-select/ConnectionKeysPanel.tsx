import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@localixai/kit/button'
import { DIVIDED_LIST } from '@localixai/kit/divided-list'
import { IconButton } from '@localixai/kit/icon-button'
import { Input } from '@localixai/kit/input'
import { SectionLabel } from '@localixai/kit/section-label'
import type { ProviderConnection } from '@/shared/api/contracts'

interface ConnectionKeysPanelProps {
  connection: ProviderConnection
  onAddKey: (id: string, apiKey: string, label?: string) => Promise<void>
  onRemoveKey: (id: string, keyId: string) => Promise<void>
  onUpdateKey: (id: string, keyId: string, patch: { enabled?: boolean }) => Promise<void>
}

export function ConnectionKeyRow({
  connectionId,
  keyEntry,
  canRemove,
  onRemoveKey,
  onUpdateKey,
}: {
  connectionId: string
  keyEntry: ProviderConnection['keys'][number]
  canRemove: boolean
  onRemoveKey: ConnectionKeysPanelProps['onRemoveKey']
  onUpdateKey: ConnectionKeysPanelProps['onUpdateKey']
}) {
  return (
    <div className="group flex min-h-8 items-center gap-2 px-1 py-1">
      <span
        className="min-w-0 flex-1 truncate text-xs text-foreground"
        title={keyEntry.label || 'key'}
      >
        {keyEntry.label || 'key'}
      </span>
      <span className="font-mono text-2xs text-text-soft">{keyEntry.maskedKey}</span>
      <Button
        variant="ghost"
        size="xs"
        onClick={() => {
          void onUpdateKey(connectionId, keyEntry.id, { enabled: !keyEntry.enabled })
        }}
        aria-pressed={keyEntry.enabled}
        aria-label={`${keyEntry.enabled ? 'Disable' : 'Enable'} ${keyEntry.label || 'key'}`}
        className={
          keyEntry.enabled ? 'text-text-soft' : 'text-status-warning hover:text-status-warning/80'
        }
      >
        {keyEntry.enabled ? 'On' : 'Off'}
      </Button>
      {canRemove && (
        <IconButton
          size="sm"
          tone="danger"
          onClick={() => {
            void onRemoveKey(connectionId, keyEntry.id)
          }}
          aria-label={`Remove ${keyEntry.label || 'key'}`}
          tooltip="Remove key"
          className="sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
        >
          <Trash2 />
        </IconButton>
      )}
    </div>
  )
}

export function ConnectionKeysPanel({
  connection,
  onAddKey,
  onRemoveKey,
  onUpdateKey,
}: ConnectionKeysPanelProps) {
  const [newKey, setNewKey] = useState('')
  const [busy, setBusy] = useState(false)

  const handleAdd = async () => {
    const k = newKey.trim()
    if (!k) return
    setBusy(true)
    try {
      await onAddKey(connection.id, k)
      setNewKey('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-2 mt-1">
      <div className="flex items-center justify-between">
        <SectionLabel as="span" weight="semibold">
          API Keys ({connection.keyCount})
        </SectionLabel>
      </div>

      <div className={DIVIDED_LIST}>
        {connection.keys.map((keyEntry) => (
          <ConnectionKeyRow
            key={keyEntry.id}
            connectionId={connection.id}
            keyEntry={keyEntry}
            canRemove={connection.keys.length > 1}
            onRemoveKey={onRemoveKey}
            onUpdateKey={onUpdateKey}
          />
        ))}
      </div>

      <div className="flex items-center gap-1.5">
        <Input
          type="password"
          size="lg"
          placeholder="Add another API key"
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void handleAdd()
          }}
          className="flex-1"
        />
        <Button
          variant="mono"
          size="lg"
          disabled={!newKey.trim() || busy}
          onClick={() => {
            void handleAdd()
          }}
          aria-label="Add key"
          className="px-3 font-semibold"
        >
          <Plus className="size-3.5" />
        </Button>
      </div>
    </div>
  )
}
