import { useState } from 'react'
import type { RepoCommit } from '../../../backend/source-control/contracts'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@localixai/kit/dialog'
import { Button } from '@localixai/kit/button'
import { Input } from '@localixai/kit/input'
import { Textarea } from '@localixai/kit/textarea'
import { focusOnMount } from './focusOnMount'

/**
 * The commit graph's two prompts. Each keys its draft on the target commit, so reopening for
 * another commit starts from that commit's own value instead of the previous draft — the graph
 * used to hold both drafts itself and reset them by hand at every exit.
 */
export function BranchAtDialog({
  target,
  onClose,
  onSubmit,
}: {
  target: RepoCommit | null
  onClose: () => void
  onSubmit: (name: string, target: RepoCommit) => void
}) {
  return (
    <Dialog open={target !== null} onOpenChange={(v) => !v && onClose()}>
      <DialogContent size="xs">
        <DialogHeader>
          <DialogTitle>New branch here</DialogTitle>
        </DialogHeader>
        {target && (
          <BranchAtForm key={target.hash} target={target} onClose={onClose} onSubmit={onSubmit} />
        )}
      </DialogContent>
    </Dialog>
  )
}

function BranchAtForm({
  target,
  onClose,
  onSubmit,
}: {
  target: RepoCommit
  onClose: () => void
  onSubmit: (name: string, target: RepoCommit) => void
}) {
  const [name, setName] = useState('')
  const submit = () => {
    const trimmed = name.trim()
    if (trimmed) onSubmit(trimmed, target)
  }
  return (
    <>
      {/* `DialogBody` owns the one scrolling region a standard dialog is allowed; a dialog that
          declares a header/footer but drops it is what `modal-surface` flags. */}
      <DialogBody className="grid gap-3">
        <Input
          ref={focusOnMount}
          aria-label="Branch name"
          value={name}
          placeholder="branch name…"
          spellCheck={false}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              submit()
            }
          }}
          className="rounded-none border-x-0 border-t-0 bg-transparent px-0 text-text-strong"
        />
        <p className="text-2xs text-text-faint">
          Points at {target.shortHash} — {target.subject}. HEAD is left where it is.
        </p>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" size="xl" className="rounded-lg text-text-soft" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="mono"
          size="xl"
          className="rounded-lg"
          disabled={!name.trim()}
          onClick={submit}
        >
          Create branch
        </Button>
      </DialogFooter>
    </>
  )
}

export function RewordDialog({
  target,
  onClose,
  onSubmit,
}: {
  target: RepoCommit | null
  onClose: () => void
  onSubmit: (message: string, target: RepoCommit) => void
}) {
  return (
    <Dialog open={target !== null} onOpenChange={(v) => !v && onClose()}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Reword commit {target?.shortHash}</DialogTitle>
        </DialogHeader>
        {target && (
          <RewordForm key={target.hash} target={target} onClose={onClose} onSubmit={onSubmit} />
        )}
      </DialogContent>
    </Dialog>
  )
}

function RewordForm({
  target,
  onClose,
  onSubmit,
}: {
  target: RepoCommit
  onClose: () => void
  onSubmit: (message: string, target: RepoCommit) => void
}) {
  const [message, setMessage] = useState(target.subject)
  const submit = () => {
    const trimmed = message.trim()
    if (trimmed) onSubmit(trimmed, target)
  }
  return (
    <>
      <DialogBody className="grid gap-3">
        <Textarea
          ref={focusOnMount}
          value={message}
          spellCheck={false}
          rows={3}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              submit()
            }
          }}
        />
        <p className="text-2xs text-text-faint">
          Rewrites this commit and everything after it. ⌘/Ctrl+Enter to save.
        </p>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" size="xl" className="rounded-lg text-text-soft" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="mono"
          size="xl"
          className="rounded-lg"
          disabled={!message.trim()}
          onClick={submit}
        >
          Reword
        </Button>
      </DialogFooter>
    </>
  )
}
