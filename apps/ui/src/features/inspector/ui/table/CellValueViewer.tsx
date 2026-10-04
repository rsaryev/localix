import { useState } from 'react'
import { copyText } from '@localixai/plugin-sdk/ui/interactions'
import { Copy, Check } from 'lucide-react'
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from '@localixai/kit/dialog'
import { Button } from '@localixai/kit/button'
import { JsonTree } from '@localixai/kit/json-tree'

/** The cell a viewer is opened for: the column title + the already-formatted string. */
export interface CellView {
  title: string
  text: string
}

/** Parse a JSON object/array string into a value; null when it isn't one. */
function parseJson(text: string): unknown {
  const t = text.trim()
  if (!(t.startsWith('{') || t.startsWith('['))) return null
  try {
    return JSON.parse(t) as unknown
  } catch {
    return null
  }
}

/**
 * A read-only viewer for a single cell's full value — for wide JSON / long text / blob
 * markers that the grid truncates. Pretty-prints JSON when detected, and offers Copy.
 * Reuses the shared Dialog primitive (no bespoke overlay).
 */
export function CellValueViewer({ cell, onClose }: { cell: CellView | null; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  const json = cell ? parseJson(cell.text) : null
  const text = cell?.text ?? ''

  const copy = () => {
    // The tick is this dialog's success state; the helper only needs to speak up on failure —
    // previously a missing Clipboard API left the optional chain resolving with nothing, so the
    // tick never appeared and no reason was given.
    void copyText(cell?.text ?? '', 'Cell value').then((ok) => {
      if (!ok) return
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    })
  }

  return (
    <Dialog open={!!cell} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="2xl">
        <DialogHeader
          actionsLabel="Cell value actions"
          actions={
            <Button
              variant="ghost"
              size="xs"
              onClick={copy}
              title="Copy value"
              className="text-text-soft"
            >
              {copied ? (
                <Check className="size-3 text-status-success" />
              ) : (
                <Copy className="size-3" />
              )}
              {copied ? 'Copied' : 'Copy'}
            </Button>
          }
        >
          <DialogTitle className="truncate font-mono">{cell?.title}</DialogTitle>
        </DialogHeader>
        {/* `surface-sunken`, not `bg-surface-raised`: both are the same grey on the opaque themes,
            but under glass raised mixes from an absolute darker ground while sunken is a black
            veil relative to whatever it covers — so this inset stays an inset in the dialog
            instead of a black slab on the modal's thinner glass. */}
        <DialogBody className="rounded-lg bg-surface-sunken p-3">
          {json !== null ? (
            <JsonTree value={json} expandDepth={3} />
          ) : text.length > 0 ? (
            <pre className="font-mono text-xs/relaxed whitespace-pre-wrap break-words text-foreground">
              {text}
            </pre>
          ) : (
            <span className="text-text-faint italic">empty</span>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}
