import { useState } from 'react'
import { ListChecks } from 'lucide-react'
import type { MiniAppUiHost } from '@localixai/mini-app-sdk/ui'
import { Checkbox } from '@localixai/kit/checkbox'
import { ProgressBar } from '@localixai/kit/progress-bar'

const initialChecks = [
  {
    title: 'Review the workspace layout',
    owner: '@frontend',
    detail: 'Shared panels and clear navigation',
    done: true,
  },
  {
    title: 'Check the release states',
    owner: '@qa',
    detail: 'Pending and ready paths verified',
    done: true,
  },
  {
    title: 'Review the mobile preview',
    owner: '@frontend',
    detail: 'Small screens and keyboard focus',
    done: true,
  },
  {
    title: 'Write the release notes',
    owner: '@lead',
    detail: 'Document the changes before shipping',
    done: false,
  },
]

function ReleaseChecklist() {
  const [checks, setChecks] = useState(initialChecks)
  const done = checks.filter((check) => check.done).length
  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="flex items-center gap-2 text-xs text-text-soft">
        <ListChecks className="size-4" />
        <span>Release Studio</span>
        <span className="ml-auto rounded-sm border border-border-subtle px-2 py-1">
          Demo plugin
        </span>
      </div>
      <h1 className="mt-8 text-2xl font-semibold tracking-tight">Ready to ship?</h1>
      <p className="mt-2 text-sm text-text-soft">A shared checklist for the workspace update.</p>
      <div className="mt-8 flex items-end justify-between gap-4">
        <div>
          <p className="text-xs text-text-faint">RELEASE</p>
          <h2 className="mt-1 text-lg font-medium">
            Workspace update <span className="text-text-soft">v1.4</span>
          </h2>
        </div>
        <span className="text-sm text-text-soft">
          {done} of {checks.length} complete
        </span>
      </div>
      <ProgressBar
        className="mt-4 h-1.5"
        value={(done / checks.length) * 100}
        aria-label="Release checks completed"
        aria-valuemin={0}
        aria-valuemax={4}
        aria-valuenow={done}
      />
      <div className="mt-6 divide-y divide-border-subtle border-y border-border-subtle">
        {checks.map((check, index) => (
          <label key={check.title} className="flex cursor-pointer items-center gap-4 py-5">
            <Checkbox
              checked={check.done}
              onChange={() =>
                setChecks(
                  checks.map((item, i) => (i === index ? { ...item, done: !item.done } : item)),
                )
              }
            />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">{check.title}</span>
              <span className="mt-1 block text-xs text-text-soft">{check.detail}</span>
            </span>
            <span className="text-xs text-text-soft">{check.owner}</span>
          </label>
        ))}
      </div>
      <div className="mt-8 flex gap-3 rounded-md border border-border-subtle p-4">
        <span className="mt-1 size-2 shrink-0 rounded-full bg-status-success" />
        <div>
          <p className="text-sm font-medium">
            {done === checks.length ? 'All checks complete' : 'One step left'}
          </p>
          <p className="mt-1 text-xs text-text-soft">
            {done === checks.length
              ? 'The workspace update is ready for review.'
              : 'Finish the release notes, then review the update together.'}
          </p>
        </div>
      </div>
    </div>
  )
}

export function registerUi(host: MiniAppUiHost) {
  host.workItems.register({
    kind: 'release-checklist:workspace',
    Component: ReleaseChecklist,
    Icon: ListChecks,
    restorable: true,
    scope: 'session',
  })
  host.railViewlets.register({
    kind: 'release-checklist:workspace',
    title: 'Release Checklist',
    label: 'Release Checklist',
    defaultArea: 'overflow',
    Icon: ListChecks,
  })
}
