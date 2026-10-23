import { useCallback, useEffect, useState } from 'react'
import type { MiniAppProblemLineProps } from '@localixai/mini-app-sdk/ui/components'
import type { Problem } from '@localixai/mini-app-sdk/ui/problems'
import type { DbConnectionInfo } from '../../dbClient'
import { connectionDisplayName } from '../../model/connectionDisplayName'
import type { SchemaReader } from '../../model/schemaTreeRows'
import { useDbProblem } from '../../problems'

type Lines = { reconnect: MiniAppProblemLineProps | null; schema: MiniAppProblemLineProps | null }

/**
 * Ownership of each connection's standing problems, held OUTSIDE the windowed tree.
 *
 * A report lives exactly as long as the component that owns it. When the owner was the tree node,
 * the node was always mounted; in a windowed tree a row unmounts when it scrolls away, and a
 * row-owned report would be settled in the Event Center while the failure still stands. So one
 * render-less owner per connection publishes, and hands the owned line to its status row.
 */
export function useConnectionProblemLines() {
  const [lines, setLines] = useState<Readonly<Record<string, Lines>>>({})
  const report = useCallback((connectionId: string, next: Lines | null) => {
    setLines((current) => {
      if (!next) {
        if (!Object.hasOwn(current, connectionId)) return current
        const { [connectionId]: _gone, ...rest } = current
        return rest
      }
      return { ...current, [connectionId]: next }
    })
  }, [])
  const lineFor = useCallback(
    (connectionId: string, which: 'reconnect' | 'schema') =>
      (Object.hasOwn(lines, connectionId) ? lines[connectionId]![which] : null) ?? null,
    [lines],
  )
  return { report, lineFor }
}

export function ConnectionProblemOwner({
  connection,
  reconnectError,
  retryConnect,
  reader,
  onLines,
}: {
  connection: DbConnectionInfo
  reconnectError: Problem | undefined
  retryConnect: (connectionId: string) => void
  reader: SchemaReader | undefined
  onLines: (connectionId: string, lines: Lines | null) => void
}) {
  const displayName = connectionDisplayName(connection)
  const reconnect = useDbProblem(displayName, reconnectError, {
    actions: [{ id: 'retry', label: 'Retry', run: () => retryConnect(connection.id) }],
  })
  const schema = useDbProblem(`${displayName} schema`, reader?.error, {
    detail: reader?.errorDetail ?? undefined,
    actions: [{ id: 'retry', label: 'Retry', run: () => reader?.reload() }],
  })
  // The owned objects are rebuilt every render; what they SAY is what decides a hand-over.
  const fingerprint = JSON.stringify([
    reconnect?.entryId,
    reconnect?.report,
    schema?.entryId,
    schema?.report,
  ])
  useEffect(() => {
    onLines(connection.id, reconnect || schema ? { reconnect, schema } : null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connection.id, fingerprint, onLines])
  useEffect(() => () => onLines(connection.id, null), [connection.id, onLines])
  return null
}
