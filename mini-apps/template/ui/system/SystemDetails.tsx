import type { ReactNode } from 'react'
import { formatBytes, formatUptime, type SystemSnapshot } from '../../shared/system'

function Details({
  title,
  rows,
  note,
}: {
  title: string
  rows: [string, ReactNode][]
  note: string
}) {
  return (
    <section className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-border">
      <h2 className="border-b border-border px-4 py-3 text-sm font-medium">{title}</h2>
      {/* Rows take the faint step, the one weight for a divider between rows of content
          (`ui-token-rules.ts`); the full `divide-border` here drew them as heavy as the card. */}
      <dl className="flex-1 divide-y divide-border-faint px-4">
        {rows.map(([label, value]) => (
          <div
            key={label}
            className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] items-baseline gap-3 py-3 text-xs"
          >
            <dt className="text-text-soft">{label}</dt>
            <dd className="min-w-0 break-words text-right font-medium">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="border-t border-border px-4 py-3 text-xs leading-relaxed text-text-faint">
        {note}
      </p>
    </section>
  )
}

export function SystemDetails({ snapshot }: { snapshot: SystemSnapshot }) {
  return (
    <div className="grid items-stretch gap-3 @2xl:grid-cols-2">
      <Details
        title="Machine"
        rows={[
          ['Operating system', snapshot.os.name],
          ['Kernel release', snapshot.os.release],
          ['Architecture', snapshot.os.architecture],
          ['Processor', snapshot.cpu.model],
          ['Logical cores', snapshot.cpu.logicalCores],
          ['Free memory', formatBytes(snapshot.memory.freeBytes)],
        ]}
        note="Memory usage includes OS caches. These are server measurements, even when you open Localix remotely."
      />
      <Details
        title="Runtime"
        rows={[
          ['Engine', `Bun ${snapshot.runtime.version}`],
          ['Process uptime', formatUptime(snapshot.runtime.uptimeSeconds)],
          ['Resident memory', formatBytes(snapshot.runtime.memoryBytes)],
          ['Collection', 'Native OS APIs'],
          ['Access', 'Read-only'],
        ]}
        note="The same backend snapshot feeds this view, resource links and agent context. No shell commands or external services."
      />
    </div>
  )
}
