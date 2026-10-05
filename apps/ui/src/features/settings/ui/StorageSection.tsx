import { useCallback, useEffect, useState } from 'react'
import { Button } from '@localixai/kit/button'
import { ConfirmDialog } from '@localixai/kit/confirm-dialog'
import { Select } from '@localixai/kit/select'
import { useWorkItemVisible } from '@localixai/plugin-sdk/ui/visibility'
import { storageApi, type PruneResult, type StorageUsage } from '@/shared/api/storageApi'
import { inlineFailure } from '@/shared/lib/notifications/inlineReport'
import { useUserSettings } from '../model/useUserSettings'
import {
  formatBytes,
  pruneSummary,
  RETENTION_DAY_CHOICES,
  retentionValue,
  usageLines,
} from '../model/storageFormat'
import { SettingsRow, SettingsRows, SettingsSection } from './SettingsScaffold'
import { SettingsActionActivity } from './SettingsActionActivity'

const DAY_OPTIONS = RETENTION_DAY_CHOICES.map((days) => ({
  value: String(days),
  label: days === 365 ? '1 year' : `${days} days`,
}))
const RETENTION_OPTIONS = [{ value: 'off', label: 'Keep everything' }, ...DAY_OPTIONS]

/**
 * Settings → General → Storage: how much disk the app's data takes, removing conversations that
 * have gone quiet, and an optional daily clean-up. Nothing is removed unless the person asks: the
 * count comes first, the removal needs a confirmation, and the automatic clean-up is off until
 * a window is chosen. Pinned and running conversations are never removed.
 */
export function StorageSection() {
  return (
    <SettingsSection
      anchor="general-storage"
      title="Storage"
      description="Conversations are kept in full on this computer so they can be reopened and searched. Remove the ones you no longer need."
    >
      <SettingsRows>
        <UsageRow />
        <RemoveOldRow />
        <AutoRemoveRow />
      </SettingsRows>
    </SettingsSection>
  )
}

function UsageRow() {
  const visible = useWorkItemVisible()
  const [usage, setUsage] = useState<StorageUsage | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setUsage(await storageApi.usage())
    } catch (e) {
      setError(inlineFailure(e, 'Storage use could not be read.'))
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => {
    if (visible) void load()
  }, [visible, load])

  const lines = usage ? usageLines(usage) : []
  const saved = usage ? usage.toolOutputRawBytes - usage.toolOutputBytes : 0
  return (
    <SettingsRow layout="responsive">
      <div className="space-y-1">
        <p className="text-sm font-normal text-foreground">
          {usage ? `${formatBytes(usage.fileBytes + usage.walBytes)} on disk` : 'Disk use'}
        </p>
        {usage && (
          <p className="text-sm text-text-faint" aria-live="polite">
            {lines.map((line) => `${line.label} ${formatBytes(line.bytes)}`).join(' · ')}
            {saved > 0 && ` · compression saves ${formatBytes(saved)}`}
          </p>
        )}
        {usage && usage.freeBytes > 0 && (
          <p className="text-sm text-text-faint">
            {formatBytes(usage.freeBytes)} is free inside the file and is returned to the disk by
            the next clean-up.
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-status-error">
            {error}
          </p>
        )}
      </div>
      <Button
        variant="outline"
        size="xl"
        aria-busy={loading || undefined}
        disabled={loading}
        onClick={() => void load()}
      >
        {loading ? <SettingsActionActivity label="Reading" /> : 'Refresh'}
      </Button>
    </SettingsRow>
  )
}

function RemoveOldRow() {
  const [days, setDays] = useState(String(RETENTION_DAY_CHOICES[1]))
  const [counted, setCounted] = useState<PruneResult | null>(null)
  const [busy, setBusy] = useState<'count' | 'remove' | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const run = async (dryRun: boolean) => {
    setBusy(dryRun ? 'count' : 'remove')
    setError(null)
    try {
      const result = await storageApi.prune({ olderThanDays: Number(days), dryRun })
      if (dryRun) {
        setCounted(result)
        setDone(null)
      } else {
        setCounted(null)
        setDone(pruneSummary(result))
      }
    } catch (e) {
      setError(inlineFailure(e, 'Old conversations could not be removed.'))
    } finally {
      setBusy(null)
    }
  }

  return (
    <SettingsRow layout="responsive">
      <div className="space-y-1">
        <p className="text-sm font-normal text-foreground">Remove old conversations</p>
        <p className="text-sm text-text-faint" aria-live="polite">
          {counted
            ? pruneSummary(counted)
            : (done ?? 'Conversations with no new message for this long. Pinned ones stay.')}
        </p>
        {error && (
          <p role="alert" className="text-sm text-status-error">
            {error}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Select
          aria-label="Remove conversations older than"
          className="w-32"
          value={days}
          options={DAY_OPTIONS}
          onValueChange={(value) => {
            setDays(value)
            setCounted(null)
            setDone(null)
          }}
        />
        {counted && counted.sessions > 0 ? (
          <Button
            variant="outline"
            size="xl"
            aria-busy={busy === 'remove' || undefined}
            disabled={busy !== null}
            onClick={() => setConfirmOpen(true)}
          >
            {busy === 'remove' ? <SettingsActionActivity label="Removing" /> : 'Remove…'}
          </Button>
        ) : (
          <Button
            variant="outline"
            size="xl"
            aria-busy={busy === 'count' || undefined}
            disabled={busy !== null}
            onClick={() => void run(true)}
          >
            {busy === 'count' ? <SettingsActionActivity label="Counting" /> : 'Review'}
          </Button>
        )}
      </div>
      <ConfirmDialog
        open={confirmOpen}
        title="Remove old conversations?"
        description={`${counted ? pruneSummary(counted) : ''} This cannot be undone.`}
        confirmLabel="Remove"
        onConfirm={() => {
          setConfirmOpen(false)
          void run(false)
        }}
        onClose={() => setConfirmOpen(false)}
      />
    </SettingsRow>
  )
}

function AutoRemoveRow() {
  const retentionDays = useUserSettings((s) => s.settings.agentSettings?.storage?.retentionDays)
  const update = useUserSettings((s) => s.update)

  const choose = (value: string) => {
    // Read the live value at write time so a quick second change cannot overwrite an unrelated one.
    const base = useUserSettings.getState().settings.agentSettings ?? {}
    update({
      agentSettings: {
        ...base,
        storage: value === 'off' ? {} : { retentionDays: Number(value) },
      },
    })
  }

  return (
    <SettingsRow layout="responsive">
      <div className="space-y-1">
        <p className="text-sm font-normal text-foreground">Remove automatically</p>
        <p className="text-sm text-text-faint">
          {retentionDays
            ? `Once a day, conversations with no message for ${retentionDays} days are removed.`
            : 'Off. History is kept until you remove it.'}
        </p>
      </div>
      <Select
        aria-label="Remove conversations automatically after"
        className="w-40 shrink-0 @max-md:w-full"
        value={retentionValue(retentionDays)}
        options={RETENTION_OPTIONS}
        onValueChange={choose}
      />
    </SettingsRow>
  )
}
