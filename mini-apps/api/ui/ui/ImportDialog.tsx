/**
 * Import is a deliberate preview → save flow. A browser HAR can contain hundreds of requests, and a
 * Postman environment contains none, so neither "save immediately" nor "first request or failure"
 * is a truthful UI model.
 */

import { useRef, useState } from 'react'
import { FileUp } from 'lucide-react'
import { acknowledgeInline } from '@localixai/mini-app-sdk/ui'
import { Button } from '@localixai/kit/button'
import { Field } from '@localixai/kit/field'
import { Input } from '@localixai/kit/input'
import { Textarea } from '@localixai/kit/textarea'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@localixai/kit/dialog'
import type { ImportResponse } from '../../backend/contracts'
import { useApiProblem } from '../problems'
import { restApi } from '../restApi'
import { focusOnMount } from './focusOnMount'

export function ImportDialog({
  sessionId,
  open,
  onOpenChange,
  onImported,
}: {
  sessionId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Saved: refresh what the import touched and select its first request. */
  onImported: (res: ImportResponse) => Promise<void>
}) {
  const [importText, setImportText] = useState('')
  const [importBaseUrl, setImportBaseUrl] = useState('')
  const [importPreview, setImportPreview] = useState<ImportResponse | null>(null)
  const [importResult, setImportResult] = useState<ImportResponse | null>(null)
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState<{ message: string; detail?: string } | null>(null)
  const importFile = useRef<HTMLInputElement>(null)
  const closeImport = () => {
    onOpenChange(false)
    setImportText('')
    setImportBaseUrl('')
    setImportPreview(null)
    setImportResult(null)
    setImportError(null)
  }
  const changeImportSource = (source: string) => {
    setImportText(source)
    setImportPreview(null)
    setImportResult(null)
    setImportError(null)
  }
  const runImport = (save: boolean) => {
    const source = importText.trim()
    if (source === '' || importing) return
    setImporting(true)
    setImportError(null)
    void restApi
      .importSource(sessionId, {
        source,
        save,
        ...(importBaseUrl.trim() ? { baseUrl: importBaseUrl.trim() } : {}),
      })
      .then(async (res) => {
        if (save) {
          await onImported(res)
          setImportResult(res)
        } else {
          setImportPreview(res)
        }
      })
      .catch((err: unknown) => {
        acknowledgeInline(err)
        // The importer's diagnostic is a multi-paragraph report about somebody's OpenAPI file. It
        // is the most useful thing here and the worst possible headline, so the sentence goes on
        // the line and the report goes where there is room for it.
        const detail =
          err instanceof Error && 'detail' in err && typeof err.detail === 'string'
            ? err.detail
            : ''
        setImportError({
          message: err instanceof Error ? err.message : 'Import failed.',
          ...(detail ? { detail } : {}),
        })
      })
      .finally(() => {
        setImporting(false)
      })
  }

  // Owned here, drawn in the dialog body: the body unmounts on close, and an owner that unmounts
  // never settles the row it published.
  const importProblem = useApiProblem({
    subject: 'Import',
    message: importError?.message,
    detail: importError?.detail,
  })

  return (
    <Dialog open={open} onOpenChange={(open) => (open ? onOpenChange(true) : closeImport())}>
      <DialogContent size="2xl">
        <DialogHeader>
          <DialogTitle>Import</DialogTitle>
          <DialogDescription>
            cURL, OpenAPI, Postman, Insomnia, HAR, or a Localix request file.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="grid gap-3">
          {!importResult && (
            <>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => importFile.current?.click()}>
                  <FileUp className="size-3.5" />
                  Choose file
                </Button>
                <span className="text-2xs text-text-faint">or paste the source below</span>
                <input
                  ref={importFile}
                  type="file"
                  className="hidden"
                  accept=".json,.yaml,.yml,.har,.txt"
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    if (!file) return
                    void file.text().then(changeImportSource)
                    event.target.value = ''
                  }}
                />
              </div>
              <Textarea
                ref={focusOnMount}
                value={importText}
                onChange={(e) => changeImportSource(e.target.value)}
                placeholder="curl https://api.example.com/users"
                aria-label="Import source"
                className="min-h-36 font-mono"
              />
              <Field label="Base URL (optional)">
                <Input
                  value={importBaseUrl}
                  onChange={(event) => {
                    setImportBaseUrl(event.target.value)
                    setImportPreview(null)
                  }}
                  placeholder="https://api.example.com"
                  className="font-mono text-xs"
                />
              </Field>
            </>
          )}
          {(importResult ?? importPreview) && (
            <pre className="scrollbar-thin max-h-56 overflow-auto whitespace-pre-wrap rounded-md border border-border-soft bg-surface-sunken p-3 font-mono text-2xs text-text-soft">
              {(importResult ?? importPreview)?.message}
            </pre>
          )}
          {importProblem}
        </DialogBody>
        <DialogFooter>
          {importResult ? (
            <Button variant="mono" onClick={closeImport}>
              Done
            </Button>
          ) : (
            <>
              <Button variant="ghost" onClick={closeImport}>
                Cancel
              </Button>
              {importPreview ? (
                <Button variant="mono" disabled={importing} onClick={() => runImport(true)}>
                  {importing ? 'Importing…' : 'Import'}
                </Button>
              ) : (
                <Button
                  variant="mono"
                  disabled={importing || importText.trim() === ''}
                  onClick={() => runImport(false)}
                >
                  {importing ? 'Reading…' : 'Preview'}
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
