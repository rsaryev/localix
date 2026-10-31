import { CircleAlert } from 'lucide-react'
import { Spinner } from '@localixai/kit/spinner'
import { WorkbenchStatusItem } from '@localixai/kit/workbench-statusbar'
import type { LspServerState } from '@/shared/api/contracts'

/** One status-bar line for the language servers being installed, or why one could not be. */
function lspInstallLine(
  servers: LspServerState[],
): { text: string; announce: string; title: string; working: boolean } | null {
  const installing = [
    ...new Set(servers.filter((s) => s.status === 'installing').map((s) => s.serverName)),
  ]
  if (installing.length) {
    const names = installing.join(', ')
    const progress =
      installing.length === 1 ? servers.find((s) => s.status === 'installing')?.progress : undefined
    return {
      working: true,
      announce: `Installing ${names}`,
      text:
        progress === undefined
          ? `Installing ${names}`
          : `Installing ${names} ${Math.round(progress * 100)}%`,
      title: `Installing the ${names} language server${installing.length > 1 ? 's' : ''}. Code intelligence starts when it is ready.`,
    }
  }
  const blocked = servers.find((s) => s.status === 'unavailable' && s.unavailable)
  if (!blocked?.unavailable) return null
  const { serverName: name, unavailable } = blocked
  const { detail } = unavailable
  switch (unavailable.reason) {
    case 'needs-toolchain':
      return {
        working: false,
        announce: `${name} needs ${detail}`,
        text: `${name} needs ${detail}`,
        title: `The ${name} language server is built with ${detail}. Install ${detail} to get code intelligence for these files.`,
      }
    case 'offline':
      return {
        working: false,
        announce: `${name} offline`,
        text: `${name} offline`,
        title: `Could not download the ${name} language server: ${detail}. It is tried again on the next edit.`,
      }
    case 'failed':
      return {
        working: false,
        announce: `${name} not installed`,
        text: `${name} not installed`,
        title: `Could not install the ${name} language server: ${detail}. It is tried again later.`,
      }
  }
}

/**
 * Language servers are not shipped: each is installed the first time a file of its language
 * opens. While that runs (or when it could not), the bar says so beside the LSP segment, the way
 * the semantic index reports its model download. Silent once every server is running.
 */
export function LspInstallStatusItem({ servers }: { servers: LspServerState[] }) {
  const line = lspInstallLine(servers)
  if (!line) return null
  const { working } = line
  return (
    <WorkbenchStatusItem
      title={line.title}
      className={working ? 'gap-1.5 px-2' : 'gap-1.5 px-2 text-status-warning'}
    >
      {working ? <Spinner size="xs" /> : <CircleAlert className="size-3" aria-hidden="true" />}
      <span className="tabular-nums">{line.text}</span>
      {/* The percent ticks many times a second: a live region carrying it would read every tick.
          This one says what is happening, so it changes only when the install starts, or fails. */}
      <span role="status" className="sr-only">
        {line.announce}
      </span>
    </WorkbenchStatusItem>
  )
}
