import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { acknowledgeInline } from '@localixai/mini-app-sdk/ui'
import { useStoreChanges } from '@localixai/mini-app-sdk/ui/store-resource'
import { useVisiblePolling } from '@localixai/mini-app-sdk/ui/visibility'

import type {
  ReaderBookSummary,
  ReaderCollection,
  ReaderLibraryResponse,
} from '../shared/contracts'
import { readerApi } from './api'
import {
  LIBRARY_POLL_INTERVAL_MS,
  replaceLibraryBooks,
  withoutLibraryBooks,
  withoutLibraryCollection,
} from './libraryPaneModel'
import { readerBookKey, sourceForBook } from './readerSources'

/** The scanned library: loading, live refresh, and the edits that write back to it. */
export function useReaderLibrary({
  setSelectedBookKeys,
}: {
  /** Pruned on every read, so a selection never names a book that is gone. */
  setSelectedBookKeys: Dispatch<SetStateAction<Set<string>>>
}) {
  const [result, setResult] = useState<ReaderLibraryResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const readRevision = useRef({ value: 0 })
  // One read of the library, newest wins. The state it settles is set when the answer arrives.
  const read = useCallback(() => {
    const revision = ++readRevision.current.value
    return new Promise<ReaderLibraryResponse>((resolve) => resolve(readerApi.library()))
      .then(
        (next) => {
          if (revision !== readRevision.current.value) return
          setResult(next)
          const available = new Set(next.books.map(readerBookKey))
          setSelectedBookKeys(
            (current) => new Set([...current].filter((key) => available.has(key))),
          )
          setError(null)
        },
        (cause: unknown) => {
          if (revision !== readRevision.current.value) return
          acknowledgeInline(cause)
          setError(cause instanceof Error ? cause.message : String(cause))
        },
      )
      .finally(() => {
        if (revision === readRevision.current.value) setLoading(false)
      })
  }, [setSelectedBookKeys])
  /** A re-read of a library already on screen shows as loading again. */
  const refresh = useCallback(() => {
    setLoading(true)
    return read()
  }, [read])

  // The first read: `loading` already starts true, so only the read itself is begun here.
  useEffect(() => {
    const revision = readRevision.current
    void read()
    return () => {
      revision.value++
    }
  }, [read])
  const live = useStoreChanges({ miniApp: 'reader', sessionId: null }, () => void refresh())
  useVisiblePolling({ enabled: !live, intervalMs: LIBRARY_POLL_INTERVAL_MS, onTick: refresh })

  const replaceBooks = useCallback((updated: ReaderBookSummary[]) => {
    setResult((current) => replaceLibraryBooks(current, updated))
  }, [])

  /** Removes the books from Reader; resolves to the removed keys, or reports the failure and resolves null. */
  const removeBooks = async (books: ReaderBookSummary[]): Promise<Set<string> | null> => {
    try {
      const removed = await readerApi.removeMany(books.map(sourceForBook))
      if (removed !== books.length) {
        throw new Error(`Reader removed ${removed} of ${books.length} selected books`)
      }
      const removedKeys = new Set(books.map(readerBookKey))
      setResult((current) => withoutLibraryBooks(current, removedKeys))
      return removedKeys
    } catch (cause) {
      acknowledgeInline(cause)
      setError(cause instanceof Error ? cause.message : String(cause))
      return null
    }
  }

  const updateMetadata = async (
    book: ReaderBookSummary,
    patch: Parameters<typeof readerApi.updateMetadata>[1],
  ) => {
    replaceBooks([await readerApi.updateMetadata(sourceForBook(book), patch)])
  }

  const changeCollections = async (
    books: ReaderBookSummary[],
    addIds: string[],
    removeIds: string[],
  ) => {
    if (!books.length) return
    replaceBooks(await readerApi.changeCollections(books.map(sourceForBook), addIds, removeIds))
  }

  const createCollection = async (name: string): Promise<ReaderCollection> => {
    const collection = await readerApi.createCollection(name)
    setResult((current) =>
      current ? { ...current, collections: [...current.collections, collection] } : current,
    )
    return collection
  }

  const renameCollection = async (id: string, name: string) => {
    const collection = await readerApi.renameCollection(id, name)
    setResult((current) =>
      current
        ? {
            ...current,
            collections: current.collections.map((item) =>
              item.id === collection.id ? collection : item,
            ),
          }
        : current,
    )
  }

  const removeCollection = async (id: string) => {
    const removed = await readerApi.removeCollection(id)
    if (!removed) throw new Error('Reader collection was not found')
    setResult((current) => withoutLibraryCollection(current, id))
  }

  return {
    result,
    loading,
    error,
    setError,
    refresh,
    removeBooks,
    updateMetadata,
    changeCollections,
    createCollection,
    renameCollection,
    removeCollection,
  }
}
