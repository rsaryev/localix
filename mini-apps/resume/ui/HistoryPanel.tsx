import { useEffect, useState } from 'react'
import { Button } from '@localixai/kit/button'
import { EmptyHint, LoadingHint } from '@localixai/kit/empty-hint'
import { snippetMessageBindingDraft, type PublishMessageContext } from '@localixai/mini-app-sdk/ui'
import type { Resume } from '../shared/schema'
import type { RevisionRecord } from '../shared/file-contract'
import { exportDocument } from '../shared/format'
import { resumeApi } from './api'
import { ChoiceMenu } from './ChoiceMenu'
import { Preview } from './Preview'

export function HistoryPanel({
  sessionId,
  resume,
  dirty,
  pending,
  onRestore,
  onClose,
  publishMessageContext,
}: {
  sessionId: string
  resume: Resume
  dirty: boolean
  pending: boolean
  onRestore: (revision: string) => void
  onClose: () => void
  publishMessageContext?: PublishMessageContext
}) {
  const [records, setRecords] = useState<Omit<RevisionRecord, 'document'>[] | null>(null)
  const [selected, setSelected] = useState(resume.revision)
  const [record, setRecord] = useState<RevisionRecord | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState(false)
  const [refresh, setRefresh] = useState(0)
  // A new resume, revision or retry starts the list from "loading": reset while rendering.
  const listKey = `${sessionId}\u0000${resume.id}\u0000${resume.revision}\u0000${refresh}`
  const [listedKey, setListedKey] = useState(listKey)
  if (listedKey !== listKey) {
    setListedKey(listKey)
    setRecords(null)
    setListError(null)
  }
  useEffect(() => {
    let live = true
    void resumeApi.history(sessionId, resume.id).then(
      (items) => {
        if (live) setRecords(items)
      },
      (reason: unknown) => {
        if (live)
          setListError(reason instanceof Error ? reason.message : 'Could not read history. Retry.')
      },
    )
    return () => {
      live = false
    }
  }, [sessionId, resume.id, resume.revision, refresh])
  const recordKey = `${sessionId}\u0000${resume.id}\u0000${selected}\u0000${refresh}`
  const [openedKey, setOpenedKey] = useState(recordKey)
  if (openedKey !== recordKey) {
    setOpenedKey(recordKey)
    setRecord(null)
    setConfirm(false)
  }
  useEffect(() => {
    let live = true
    void resumeApi.revision(sessionId, resume.id, selected).then(
      (item) => {
        if (live) {
          setRecord(item)
          setError(null)
        }
      },
      (reason: unknown) => {
        if (live)
          setError(
            reason instanceof Error ? reason.message : 'Could not read this revision. Retry.',
          )
      },
    )
    return () => {
      live = false
    }
  }, [sessionId, resume.id, selected, refresh])
  useEffect(() => {
    if (!record) return
    publishMessageContext?.({
      strategy: 'replace',
      bindings: [
        snippetMessageBindingDraft({
          label: `${record.document.title} · saved history`,
          language: 'text',
          content: `Historical resume snapshot. ID: ${resume.id}. Revision: ${record.revision}. This is not the current editor state.\n\n${exportDocument(record.document, 'text')}`,
        }),
      ],
    })
    return () => publishMessageContext?.(null)
  }, [record, resume.id, resume.document.title, publishMessageContext])
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
        <ChoiceMenu
          label="Saved history"
          entries={(records ?? []).map((item) => ({
            id: item.revision,
            label: new Date(item.recordedAt).toLocaleString(),
            description: `${item.actor} · ${item.label}`,
            selected: selected === item.revision,
            onSelect: () => setSelected(item.revision),
          }))}
        />
        <Button
          variant="field"
          size="sm"
          disabled={!record || selected === resume.revision || dirty || pending}
          onClick={() => setConfirm(true)}
        >
          Restore this version…
        </Button>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Back to editor
        </Button>
      </div>
      {(error || listError) && (
        <div role="alert" className="px-4 py-3 text-xs text-status-error">
          {error || listError}
          <Button variant="ghost" size="sm" onClick={() => setRefresh((value) => value + 1)}>
            Retry
          </Button>
        </div>
      )}
      {dirty && (
        <p className="px-4 py-2 text-xs text-text-soft">
          Save or discard your draft before restoring history.
        </p>
      )}
      {confirm && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3 text-xs">
          <span>Restore as a new revision? Your current saved version stays in history.</span>
          <Button
            variant="field"
            size="sm"
            disabled={dirty || pending}
            onClick={() => {
              onRestore(selected)
              setConfirm(false)
            }}
          >
            Restore version
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setConfirm(false)}>
            Cancel
          </Button>
        </div>
      )}
      {!record && !error ? (
        <LoadingHint>Loading saved revision…</LoadingHint>
      ) : record ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <Preview document={record.document} />
        </div>
      ) : (
        <EmptyHint>Select a saved revision.</EmptyHint>
      )}
    </div>
  )
}
