import { useState } from 'react'
import { Button } from '@localixai/kit/button'
import { Field } from '@localixai/kit/field'
import { Input } from '@localixai/kit/input'
import {
  Dialog,
  DialogContent,
  DialogBody,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@localixai/kit/dialog'
import type { ResumeSummary } from '../shared/schema'
import { focusOnMount } from './focusOnMount'

export function LibraryDialog({
  action,
  resume,
  pending,
  onClose,
  onConfirm,
}: {
  action: 'rename' | 'delete'
  resume: ResumeSummary
  pending: boolean
  onClose: () => void
  onConfirm: (title: string) => Promise<boolean>
}) {
  const [title, setTitle] = useState(resume.title)
  const [failed, setFailed] = useState(false)
  const confirm = async () => {
    if (await onConfirm(title.trim())) onClose()
    else setFailed(true)
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose()
      }}
    >
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{action === 'rename' ? 'Rename resume' : 'Delete resume?'}</DialogTitle>
          <DialogDescription>
            {action === 'rename'
              ? 'Choose a name you can recognize in your library.'
              : `Delete “${resume.title}” and its saved history? Other variants remain.`}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          {action === 'rename' && (
            <Field label="Resume name">
              <Input
                ref={focusOnMount}
                value={title}
                maxLength={500}
                disabled={pending}
                onChange={(event) => setTitle(event.target.value)}
              />
            </Field>
          )}
          {failed && (
            <p role="alert" className="text-xs text-status-error">
              The operation failed. Refresh saved state and retry.
            </p>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" disabled={pending} onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={action === 'delete' ? 'destructive' : 'field'}
            disabled={pending || !title.trim()}
            onClick={() => void confirm()}
          >
            {action === 'delete' ? 'Delete resume' : 'Rename'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
