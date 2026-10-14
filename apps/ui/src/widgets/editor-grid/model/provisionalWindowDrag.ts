import type { WorkspaceDragSnapshot } from './workspaceDragSnapshot'
import type { TabTransferPayload, TabWindowDestination } from './windowTransferPayload'

export interface WindowDragPacket {
  route: string
  payload: TabTransferPayload
}
interface DragPort {
  invoke: <T>(command: string, args: Record<string, unknown>) => Promise<T> | null
  id: () => string
}

/** One provisional window per gesture, retained only when that same packet is committed. */
export function createProvisionalWindowDrag(port: DragPort) {
  let revision = 0
  const signature = ({ route, payload }: WindowDragPacket) => `${route}\n${JSON.stringify(payload)}`
  let active: {
    id: string
    key: string
    packet: string
    ready: Promise<boolean>
  } | null = null
  const cancel = (key?: string) => {
    if (!active || (key !== undefined && active.key !== key)) return
    const { id } = active
    active = null
    // Cancel immediately: native tombstones also cover a prepare IPC still in flight.
    void port.invoke('workspace_drag_cancel', { id })?.catch(() => {})
  }
  return {
    cancel,
    revision: () => revision,
    begin(
      key: string,
      packet: WindowDragPacket,
      anchor?: [number, number],
      snapshot?: WorkspaceDragSnapshot,
    ) {
      if (active?.key === key) return
      cancel()
      revision++
      const id = port.id()
      const ready = Promise.resolve(
        port.invoke('workspace_drag_prepare', {
          id,
          ...packet,
          ...(anchor ? { anchor } : {}),
          ...(snapshot ? { snapshot } : {}),
        }),
      )
        .then((destination) => typeof destination === 'string')
        .catch(() => false)
      active = { id, key, packet: signature(packet), ready }
    },
    claim(
      key: string,
      packet: WindowDragPacket,
      destination: TabWindowDestination,
    ): Promise<string> | null {
      if (!active || active.key !== key) return null
      if (active.packet !== signature(packet)) {
        // A changing file, terminal or Browser must use a fresh transfer snapshot.
        cancel(key)
        return null
      }
      const claimed = active
      active = null
      return claimed.ready.then(async (ready) => {
        const command = ready ? 'workspace_drag_commit' : 'workspace_transfer_open'
        const args = ready
          ? { id: claimed.id, asTab: destination === 'tab' }
          : { ...packet, asTab: destination === 'tab' }
        const task = port.invoke<string>(command, args)
        if (!task) throw new Error('Moving tabs requires the desktop app')
        return task
      })
    },
  }
}
