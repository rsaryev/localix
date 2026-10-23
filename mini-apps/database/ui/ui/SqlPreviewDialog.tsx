import { useEffect, useRef, useState } from 'react'
import { ArrowUpRight, Copy, Check, TriangleAlert } from 'lucide-react'
import { Button } from '@localixai/kit/button'
import { copyText } from '@localixai/mini-app-sdk/ui/interactions'
import { acknowledgeInline } from '@localixai/mini-app-sdk/ui'
import { ProblemLine } from '@localixai/mini-app-sdk/ui/components'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@localixai/kit/dialog'
import { LoadingHint } from '@localixai/kit/empty-hint'
import { CodeEditor } from '@localixai/kit/code-editor'
import { Spinner } from '@localixai/kit/spinner'
import { ObjectErrorState, useObjectProblem } from './ObjectErrorState'
import { useDbProblem } from '../problems'

const NO_WARNINGS: string[] = []

/**
 * A read-only SQL viewer for a table's DDL or a generated statement. Uses the same
 * Monaco surface as the console, so syntax colors, selection, find and bracket matching
 * stay consistent instead of falling back to an unstructured `<pre>`.
 */
export function SqlPreviewDialog({
  open,
  title,
  sql,
  loadError,
  loadErrorDetail,
  onRetryLoad,
  warnings = NO_WARNINGS,
  onOpenSql,
  onApply,
  applyLabel = 'Apply',
  onClose,
}: {
  open: boolean
  title: string
  sql: string
  /**
   * Why `sql` is empty, when the caller could not build it. Without this an empty `sql`
   * is indistinguishable from "still introspecting", and the dialog showed its loading
   * hint forever on a failed read.
   */
  loadError?: string | null
  /** The raw driver text behind {@link loadError}. Event Center only. */
  loadErrorDetail?: string
  onRetryLoad?: () => void
  warnings?: string[]
  onOpenSql?: (sql: string) => void
  onApply?: () => Promise<void>
  applyLabel?: string
  onClose: () => void
}) {
  const [copied, setCopied] = useState(false)
  const [editorReady, setEditorReady] = useState(false)
  const [applying, setApplying] = useState(false)
  const [applyError, setApplyError] = useState<string | null>(null)
  const applyActive = useRef(false)
  const applyProblem = useDbProblem(title, applyError, { consequence: 'none' })
  // Owned above the `sql.length > 0` branch that renders it: a retry that succeeds replaces the
  // error state with the editor, and an owner living in that branch could never say so.
  const loadProblem = useObjectProblem(
    `${title} SQL`,
    open ? loadError : null,
    () => onRetryLoad?.(),
    { detail: loadErrorDetail },
  )
  const context = useRef({ open })
  context.current = { open }

  // The editor remounts per open; `sql` is deliberately NOT a dependency. This dialog is
  // modal and read-only, so the previewed script only changes because the CALLER's plan
  // changed — and after a failed apply that is precisely because the caller re-read the
  // object to see what actually landed. Clearing the error there would hide the failure at
  // the one moment the script visibly changes under the user.
  //
  // Reset on CLOSE too, not only on open: a failed apply the person then closed away from used to
  // keep asserting itself in the Event Center until the dialog happened to be opened again.
  useEffect(() => {
    setEditorReady(false)
    setApplyError(null)
  }, [open])

  const copy = () => {
    // The tick is this control's own success state (the helper posts no success row) — and a
    // MISSING clipboard API (insecure context) previously left the optional chain to resolve with
    // nothing and the tick never appeared, with no reason given; the helper now reports that.
    void copyText(sql, 'SQL').then((ok) => {
      if (!ok) return
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    })
  }

  const apply = async () => {
    if (!onApply || applyActive.current) return
    applyActive.current = true
    setApplying(true)
    setApplyError(null)
    try {
      await onApply()
    } catch (cause) {
      // Only "is the dialog still open" — the previous guard also required the script to be
      // UNCHANGED, which silently swallowed the error whenever a failed apply made the caller
      // refresh its plan. `applyActive` already makes a second apply impossible while one runs,
      // so there is no other attempt whose error this could be confused with.
      if (context.current.open) {
        acknowledgeInline(cause)
        setApplyError(cause instanceof Error ? cause.message : 'Could not apply these changes.')
      }
    } finally {
      applyActive.current = false
      setApplying(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !applyActive.current && onClose()}>
      <DialogContent size="3xl" className="overflow-hidden">
        <DialogHeader className="flex-row items-center justify-between gap-2 pr-8">
          <DialogTitle className="truncate font-mono">{title}</DialogTitle>
          <button
            type="button"
            onClick={copy}
            title="Copy SQL"
            className="flex shrink-0 items-center gap-1 rounded-sm px-1.5 py-0.5 text-2xs text-text-soft outline-none transition-colors hover:bg-surface-hover hover:text-foreground focus-ring"
          >
            {copied ? (
              <Check className="size-3 text-status-success" />
            ) : (
              <Copy className="size-3" />
            )}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </DialogHeader>
        <DialogBody className="grid gap-3">
          {sql.length > 0 ? (
            <div className="relative h-[min(60vh,32rem)] min-h-40 overflow-hidden rounded-md border border-border-soft">
              <CodeEditor
                value={sql}
                language="sql"
                readOnly
                ariaLabel={`SQL preview for ${title}`}
                onEditorReady={() => setEditorReady(true)}
                className="h-full"
              />
              {/* No fill on the loading hint: it covers the whole editor box, and `--background`
                  is a THIRD ground over the dialog's own raised surface — under the macOS glass
                  theme the three coats composited into a black rectangle. The editor host is
                  empty until Monaco mounts, so there is nothing to occlude. */}
              {!editorReady && (
                <LoadingHint className="absolute inset-0 text-xs">
                  Preparing SQL preview…
                </LoadingHint>
              )}
            </div>
          ) : loadProblem ? (
            <div className="h-40">
              <ObjectErrorState problem={loadProblem} />
            </div>
          ) : (
            <LoadingHint className="py-8 text-xs" />
          )}
          {warnings.length > 0 && (
            <div
              role="status"
              className="space-y-1 border-y border-status-warning/20 px-1 py-2 text-2xs text-text-soft"
            >
              {warnings.map((warning) => (
                <div key={warning} className="flex items-start gap-2">
                  <TriangleAlert
                    className="mt-0.5 size-3.5 shrink-0 text-status-warning"
                    aria-hidden="true"
                  />
                  <span>{warning}</span>
                </div>
              ))}
            </div>
          )}
          {applyProblem && <ProblemLine {...applyProblem} className="px-1 py-2" />}
        </DialogBody>
        {(onOpenSql || onApply) && (
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                if (!applyActive.current) onClose()
              }}
              disabled={applying}
            >
              Close
            </Button>
            {onOpenSql && (
              <Button
                variant={onApply ? 'ghost' : 'default'}
                disabled={applying}
                onClick={() => {
                  if (applyActive.current) return
                  onOpenSql(sql)
                  onClose()
                }}
              >
                <ArrowUpRight className="size-3.5" />
                Open in console
              </Button>
            )}
            {onApply && (
              <Button disabled={applying || !sql.trim()} onClick={() => void apply()}>
                {applying && <Spinner className="size-3.5" />}
                {applying ? 'Applying…' : applyLabel}
              </Button>
            )}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
