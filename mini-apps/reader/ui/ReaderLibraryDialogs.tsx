import { useMemo, useState } from 'react'
import { acknowledgeInline } from '@localixai/mini-app-sdk/ui'
import { BookOpen, FolderPlus, Pencil, RotateCcw, Trash2 } from 'lucide-react'

import { Button } from '@localixai/kit/button'
import { IconButton } from '@localixai/kit/icon-button'
import { Checkbox } from '@localixai/kit/checkbox'
import { ConfirmDialog } from '@localixai/kit/confirm-dialog'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@localixai/kit/dialog'
import { Input } from '@localixai/kit/input'
import { focusOnMount } from './focusOnMount'

import type {
  ReaderBookMetadataPatch,
  ReaderBookSummary,
  ReaderCollection,
} from '../shared/contracts'

export function ReaderMetadataDialog({
  book,
  onClose,
  onSave,
}: {
  book: ReaderBookSummary | null
  onClose: () => void
  onSave: (patch: ReaderBookMetadataPatch) => Promise<void>
}) {
  const [title, setTitle] = useState(book?.title ?? '')
  const [author, setAuthor] = useState(book?.author ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const sourceTitle = book?.sourceTitle ?? book?.title ?? ''
  const sourceAuthor = book?.sourceAuthor ?? book?.author ?? ''

  // Another book (or none) starts the form over, in the render that shows it.
  const [formBook, setFormBook] = useState(book)
  if (formBook !== book) {
    setFormBook(book)
    setTitle(book?.title ?? '')
    setAuthor(book?.author ?? '')
    setSaving(false)
    setError(null)
  }

  const cleanTitle = title.replace(/\s+/gu, ' ').trim()
  const cleanAuthor = author.replace(/\s+/gu, ' ').trim()
  const dirty = Boolean(book && (cleanTitle !== book.title || cleanAuthor !== (book.author ?? '')))

  const save = async () => {
    if (!book || !cleanTitle) return
    setSaving(true)
    setError(null)
    try {
      await onSave({
        title: cleanTitle === sourceTitle ? null : cleanTitle,
        author: cleanAuthor === sourceAuthor ? null : cleanAuthor,
      })
      onClose()
    } catch (cause) {
      acknowledgeInline(cause)
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={book !== null} onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent size="md" showCloseButton={!saving}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookOpen className="size-4 text-text-faint" aria-hidden="true" />
            Edit book details
          </DialogTitle>
          <DialogDescription>
            Changes affect only Reader’s catalog. The original book file and embedded metadata stay
            untouched.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="grid gap-4">
          <div className="flex w-full flex-col gap-1.5">
            <label
              htmlFor="reader-book-title"
              className="flex min-w-0 items-baseline justify-between gap-2 text-xs font-medium text-text-soft"
            >
              <span>Title</span>
              <span className="shrink-0 text-status-error/90">
                <span aria-hidden="true">*</span>
                <span className="sr-only">Required</span>
              </span>
            </label>
            {sourceTitle && (
              <p id="reader-book-title-source" className="text-xs/relaxed text-text-faint">
                From book: {sourceTitle}
              </p>
            )}
            <div className="flex items-center gap-2">
              <Input
                id="reader-book-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={300}
                required
                aria-invalid={!cleanTitle || undefined}
                aria-describedby={`reader-book-title-source${!cleanTitle ? ' reader-book-title-error' : ''}`}
                ref={focusOnMount}
              />
              <IconButton
                size="sm"
                onClick={() => setTitle(sourceTitle)}
                disabled={title === sourceTitle}
                aria-label="Restore title from book"
                tooltip="Use book metadata"
              >
                <RotateCcw />
              </IconButton>
            </div>
            {!cleanTitle && (
              <p
                id="reader-book-title-error"
                role="alert"
                className="text-xs/relaxed text-status-error"
              >
                Title is required
              </p>
            )}
          </div>
          <div className="flex w-full flex-col gap-1.5">
            <label
              htmlFor="reader-book-author"
              className="flex min-w-0 items-baseline justify-between gap-2 text-xs font-medium text-text-soft"
            >
              <span>Author</span>
              <span className="shrink-0 font-normal text-text-faint">Optional</span>
            </label>
            <p id="reader-book-author-source" className="text-xs/relaxed text-text-faint">
              {sourceAuthor ? `From book: ${sourceAuthor}` : 'No author found in the book'}
            </p>
            <div className="flex items-center gap-2">
              <Input
                id="reader-book-author"
                value={author}
                onChange={(event) => setAuthor(event.target.value)}
                maxLength={300}
                placeholder="Unknown author"
                aria-describedby="reader-book-author-source"
              />
              <IconButton
                size="sm"
                onClick={() => setAuthor(sourceAuthor)}
                disabled={author === sourceAuthor}
                aria-label="Restore author from book"
                tooltip="Use book metadata"
              >
                <RotateCcw />
              </IconButton>
            </div>
          </div>
          {error && (
            <p role="alert" className="text-xs/relaxed text-status-error">
              {error}
            </p>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            variant="mono"
            onClick={() => void save()}
            disabled={!dirty || !cleanTitle || saving}
          >
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

type Membership = 'all' | 'some' | 'none'

export function ReaderCollectionsDialog({
  open,
  books,
  collections,
  libraryBooks,
  onClose,
  onApply,
  onCreate,
  onRename,
  onDelete,
}: {
  open: boolean
  books: ReaderBookSummary[]
  collections: ReaderCollection[]
  libraryBooks: ReaderBookSummary[]
  onClose: () => void
  onApply: (addIds: string[], removeIds: string[]) => Promise<void>
  onCreate: (name: string) => Promise<ReaderCollection>
  onRename: (id: string, name: string) => Promise<void>
  onDelete: (id: string) => Promise<void>
}) {
  const [decisions, setDecisions] = useState<Record<string, boolean>>({})
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [pendingDelete, setPendingDelete] = useState<ReaderCollection | null>(null)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Each time the dialog opens (or is opened for other books) it starts clean, in the render that
  // shows it.
  const session = open ? books : null
  const [formSession, setFormSession] = useState(session)
  if (formSession !== session) {
    setFormSession(session)
    if (open) {
      setDecisions({})
      setNewName('')
      setEditingId(null)
      setEditingName('')
      setPendingDelete(null)
      setWorking(false)
      setError(null)
    }
  }

  const initialMembership = useMemo(() => {
    const result = new Map<string, Membership>()
    for (const collection of collections) {
      const count = books.filter((book) => book.collectionIds?.includes(collection.id)).length
      result.set(collection.id, count === 0 ? 'none' : count === books.length ? 'all' : 'some')
    }
    return result
  }, [books, collections])

  const membership = (id: string): Membership =>
    decisions[id] === undefined
      ? (initialMembership.get(id) ?? 'none')
      : decisions[id]
        ? 'all'
        : 'none'

  const create = async () => {
    const clean = newName.replace(/\s+/gu, ' ').trim()
    if (!clean) return
    setWorking(true)
    setError(null)
    try {
      const collection = await onCreate(clean)
      if (books.length > 0) {
        setDecisions((current) => ({ ...current, [collection.id]: true }))
      }
      setNewName('')
    } catch (cause) {
      acknowledgeInline(cause)
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setWorking(false)
    }
  }

  const rename = async () => {
    if (!editingId) return
    const clean = editingName.replace(/\s+/gu, ' ').trim()
    if (!clean) return
    setWorking(true)
    setError(null)
    try {
      await onRename(editingId, clean)
      setEditingId(null)
      setEditingName('')
    } catch (cause) {
      acknowledgeInline(cause)
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setWorking(false)
    }
  }

  const apply = async () => {
    setWorking(true)
    setError(null)
    try {
      const addIds = Object.entries(decisions)
        .filter(([, included]) => included)
        .map(([id]) => id)
      const removeIds = Object.entries(decisions)
        .filter(([, included]) => !included)
        .map(([id]) => id)
      await onApply(addIds, removeIds)
      onClose()
    } catch (cause) {
      acknowledgeInline(cause)
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setWorking(false)
    }
  }

  const confirmDelete = async () => {
    if (!pendingDelete) return
    setWorking(true)
    setError(null)
    try {
      await onDelete(pendingDelete.id)
      setDecisions((current) => {
        const next = { ...current }
        delete next[pendingDelete.id]
        return next
      })
      setPendingDelete(null)
    } catch (cause) {
      acknowledgeInline(cause)
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setWorking(false)
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && !working && onClose()}>
        <DialogContent size="md" showCloseButton={!working}>
          <DialogHeader>
            <DialogTitle>
              {books.length
                ? `Organize ${books.length === 1 ? 'book' : `${books.length} books`}`
                : 'Manage collections'}
            </DialogTitle>
            <DialogDescription>
              {books.length
                ? 'Books can belong to multiple collections. Mixed membership is preserved until you explicitly change it.'
                : 'Create, rename, or remove shelves without changing any book files.'}
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="grid gap-3">
            <div className="flex items-center gap-2">
              <Input
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void create()
                }}
                maxLength={80}
                placeholder="New collection"
                aria-label="New collection name"
              />
              <Button
                variant="ghost"
                onClick={() => void create()}
                disabled={!newName.trim() || working}
              >
                <FolderPlus data-icon="inline-start" /> Create
              </Button>
            </div>
            <div className="max-h-72 overflow-y-auto rounded-lg border border-border-soft p-1 scrollbar-thin">
              {collections.length ? (
                collections.map((collection) => {
                  const state = membership(collection.id)
                  const total = libraryBooks.filter((book) =>
                    book.collectionIds?.includes(collection.id),
                  ).length
                  const selectedCount = books.filter((book) =>
                    book.collectionIds?.includes(collection.id),
                  ).length
                  return (
                    <div
                      key={collection.id}
                      className="flex min-h-[var(--chrome-control-xl)] items-center gap-2 rounded-md px-2 hover:bg-surface-hover"
                    >
                      {editingId === collection.id ? (
                        <>
                          <Input
                            value={editingName}
                            onChange={(event) => setEditingName(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') void rename()
                              if (event.key === 'Escape') setEditingId(null)
                            }}
                            maxLength={80}
                            ref={focusOnMount}
                            aria-label="Collection name"
                          />
                          <Button
                            variant="mono"
                            size="sm"
                            onClick={() => void rename()}
                            disabled={!editingName.trim() || working}
                          >
                            Save
                          </Button>
                        </>
                      ) : (
                        <>
                          <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 py-1.5">
                            {books.length > 0 && (
                              <Checkbox
                                checked={state === 'all'}
                                indeterminate={state === 'some'}
                                onChange={() =>
                                  setDecisions((current) => ({
                                    ...current,
                                    [collection.id]: state !== 'all',
                                  }))
                                }
                                aria-label={`${state === 'all' ? 'Remove from' : 'Add to'} ${collection.name}`}
                              />
                            )}
                            <span className="min-w-0 flex-1 truncate text-xs font-medium">
                              {collection.name}
                            </span>
                            <span className="shrink-0 text-2xs tabular-nums text-text-faint">
                              {books.length > 0
                                ? `${selectedCount}/${books.length} selected · `
                                : ''}
                              {total} total
                            </span>
                          </label>
                          <IconButton
                            size="sm"
                            onClick={() => {
                              setEditingId(collection.id)
                              setEditingName(collection.name)
                            }}
                            aria-label={`Rename ${collection.name}`}
                            tooltip="Rename collection"
                          >
                            <Pencil />
                          </IconButton>
                          <IconButton
                            size="sm"
                            tone="danger"
                            onClick={() => setPendingDelete(collection)}
                            aria-label={`Delete ${collection.name}`}
                            tooltip="Delete collection"
                          >
                            <Trash2 />
                          </IconButton>
                        </>
                      )}
                    </div>
                  )
                })
              ) : (
                <div className="px-3 py-8 text-center text-xs text-text-faint">
                  Create a collection to build your first shelf.
                </div>
              )}
            </div>
            {error && (
              <p role="alert" className="text-xs/relaxed text-status-error">
                {error}
              </p>
            )}
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={onClose} disabled={working}>
              Cancel
            </Button>
            {books.length > 0 && (
              <Button
                variant="mono"
                onClick={() => void apply()}
                disabled={working || Object.keys(decisions).length === 0}
              >
                {working ? 'Saving…' : 'Apply'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={pendingDelete !== null}
        title={`Delete “${pendingDelete?.name ?? 'collection'}”?`}
        description="The collection disappears from the shelf. Its books, files, progress, and annotations stay intact."
        confirmLabel={working ? 'Deleting…' : 'Delete collection'}
        onConfirm={() => void confirmDelete()}
        onClose={() => !working && setPendingDelete(null)}
      />
    </>
  )
}
