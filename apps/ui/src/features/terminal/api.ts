import { WS_BASE_URL } from '@/shared/api/client'
import { client, unwrap } from '@/shared/api/internal'
import { errorMessage } from '@localixai/mini-app-sdk/ui/utilities'
import { toast } from '@/shared/lib/notify'
import type { CreateTerminalRequest, TerminalInfo } from '@localixai/api/client'

/** Create a PTY-backed terminal session for a chat workspace; returns its id + cwd. */
export async function createTerminal(input: CreateTerminalRequest): Promise<TerminalInfo> {
  const res = await client.rpc.terminal.$post({ json: input })
  if (!res.ok) throw new Error(`Could not start the terminal (${res.status}).`)
  return unwrap(res)
}

/**
 * Close a terminal session the person closed the tab of.
 *
 * It swallowed every failure, so a close that never reached the server left the shell — and
 * whatever it was running — alive with no tab and no word about it. The tab is already gone, so
 * the failure is the only place left to say so. A 404 is the PTY already gone: the goal reached.
 */
export async function closeTerminal(id: string): Promise<void> {
  try {
    const res = await client.rpc.terminal[':id'].$delete({ param: { id } })
    if (!res.ok && res.status !== 404) throw new Error(`The server answered ${res.status}.`)
  } catch (error) {
    toast.error('Could not close the terminal', {
      description: ['Its process may still be running.', errorMessage(error, '')]
        .filter(Boolean)
        .join(' '),
    })
  }
}

export type TerminalLiveness = 'alive' | 'dead' | 'unknown'

/** Ask the backend registry whether this PTY still exists. Transport failure is
 *  deliberately distinct from "dead": treating an offline daemon/network as a
 *  confirmed process exit made Web discard a perfectly healthy terminal tab. */
export async function getTerminalLiveness(id: string): Promise<TerminalLiveness> {
  try {
    const res = await client.rpc.terminal.$get()
    if (!res.ok) return 'unknown'
    const rows = await unwrap(res)
    return rows.some((r) => r.id === id) ? 'alive' : 'dead'
  } catch {
    return 'unknown'
  }
}

/** WebSocket URL for a terminal's I/O stream. Uses WS_BASE_URL (the API directly
 *  in dev, since Vite's proxy can't relay WS upgrades under Bun). */
export function terminalStreamUrl(id: string): string {
  const base = WS_BASE_URL.replace(/^http/, 'ws')
  return `${base}/rpc/terminal/${encodeURIComponent(id)}/stream`
}
