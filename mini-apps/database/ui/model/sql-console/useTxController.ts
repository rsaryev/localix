import { useCallback, useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react'
import { acknowledgeInline, enqueueMicrotask } from '@localixai/mini-app-sdk/ui'
import type { DbErrorCode } from '../../dbClient'
import { DbApiError } from '../../api/databaseApi'
import { transactionStore } from './transactionStore'

export interface TxController {
  txMode: 'auto' | 'manual'
  setTxMode: (mode: 'auto' | 'manual') => void
  txOpen: boolean
  txBusy: boolean
  txNotice: string | null
  commitTx: () => Promise<void>
  rollbackTx: () => Promise<void>
  /**
   * Manual mode: ensure a transaction is open before a statement runs so several
   * statements share one uncommitted tx (server routes /query through it). beginTx is
   * idempotent server-side; the first statement opens it, the rest reuse it.
   * Returns false (after surfacing the error) when BEGIN failed — the caller must bail.
   */
  ensureTxBeforeStatement: () => Promise<boolean>
}

/**
 * Manual-transaction state for one connection ("Tx: Auto / Manual"). The
 * backend owns one transaction per connection, so every console and SQL-file editor for
 * that connection subscribes to the same state instead of presenting contradictory modes.
 */
export function useTxController(
  connectionId: string,
  setError: (message: string | null) => void,
  setErrorCode: (code: DbErrorCode | null) => void,
): TxController {
  const activeConnectionRef = useRef(connectionId)
  useLayoutEffect(() => {
    activeConnectionRef.current = connectionId
  }, [connectionId])

  const snapshot = useSyncExternalStore(
    useCallback((listener) => transactionStore.subscribe(connectionId, listener), [connectionId]),
    useCallback(() => transactionStore.getSnapshot(connectionId), [connectionId]),
  )

  // Recover a transaction that outlived its console (tab close/reload) from the server's
  // `txOpen` connection info. The microtask avoids React StrictMode's throwaway effect.
  useEffect(() => {
    let cancelled = false
    enqueueMicrotask(() => {
      if (!cancelled) void transactionStore.refresh(connectionId).catch(() => {})
    })
    return () => {
      cancelled = true
    }
  }, [connectionId])

  const ensureTxBeforeStatement = useCallback(async (): Promise<boolean> => {
    try {
      await transactionStore.ensureOpen(connectionId)
      return true
    } catch (e) {
      if (activeConnectionRef.current !== connectionId) return false
      acknowledgeInline(e)
      setError(e instanceof Error ? e.message : 'Could not begin the transaction.')
      setErrorCode(e instanceof DbApiError ? (e.code ?? null) : null)
      return false
    }
  }, [connectionId, setError, setErrorCode])

  const setTxMode = useCallback(
    (mode: 'auto' | 'manual') => transactionStore.setMode(connectionId, mode),
    [connectionId],
  )

  // COMMIT / ROLLBACK share the whole settle lifecycle; only the API call + labels differ.
  const settleTx = useCallback(
    async (op: 'commit' | 'rollback') => {
      try {
        await transactionStore.settle(connectionId, op)
      } catch (e) {
        if (activeConnectionRef.current === connectionId) {
          acknowledgeInline(e)
          setError(
            e instanceof Error
              ? e.message
              : `Could not ${op === 'commit' ? 'commit' : 'roll back'} the transaction.`,
          )
          setErrorCode(e instanceof DbApiError ? (e.code ?? null) : null)
        }
        // The server clears its transaction slot before settlement. If the response was
        // lost or the engine rejected COMMIT, re-read the authoritative state instead of
        // leaving every console permanently claiming that the old transaction is open.
        await transactionStore.refresh(connectionId).catch(() => {})
      }
    },
    [connectionId, setError, setErrorCode],
  )
  const commitTx = useCallback(() => settleTx('commit'), [settleTx])
  const rollbackTx = useCallback(() => settleTx('rollback'), [settleTx])

  return {
    txMode: snapshot.txMode,
    setTxMode,
    txOpen: snapshot.txOpen,
    txBusy: snapshot.txBusy,
    txNotice: snapshot.txNotice,
    commitTx,
    rollbackTx,
    ensureTxBeforeStatement,
  }
}
