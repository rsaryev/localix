import { useMemo, type ReactNode } from 'react'
import type { ToolTiming } from '@/entities/chat/model/types'
import { CurrentToolCallContext, DurationsContext } from './toolTimingStore'

export function ToolTimingProvider({
  tools,
  children,
}: {
  tools?: ToolTiming[]
  children: ReactNode
}) {
  const map = useMemo(
    () => (tools?.length ? new Map(tools.map((t) => [t.toolCallId, t.durationMs])) : null),
    [tools],
  )
  return <DurationsContext.Provider value={map}>{children}</DurationsContext.Provider>
}

export function CurrentToolCallProvider({ id, children }: { id: string; children: ReactNode }) {
  return <CurrentToolCallContext.Provider value={id}>{children}</CurrentToolCallContext.Provider>
}
