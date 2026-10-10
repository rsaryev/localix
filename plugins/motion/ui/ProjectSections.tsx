import { useState } from 'react'
import { AlertTriangle, ChevronDown, Download, Play } from 'lucide-react'
import { Button } from '@localixai/kit/button'
import { formatFileSize, formatTimeAgo } from '@localixai/plugin-sdk/ui/utilities'
import type { MotionFile, MotionProject } from '../shared/contract'
import { newestFirst } from './format'
import { projectFile, projectFileUrl } from './scope'

/** What the static check found, folded to one line until opened. Fixes happen in chat. */
export function IssuesNotice({ issues }: { issues: string[] }) {
  const [open, setOpen] = useState(false)
  if (!issues.length) return null
  const sampleOnly = issues.length === 1 && issues[0]!.includes('data-sample')
  return (
    <div className="rounded-md border border-border-soft bg-foreground/[0.03] text-xs">
      <Button
        size="sm"
        variant="ghost"
        className="w-full justify-start"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <AlertTriangle data-icon="inline-start" className="text-status-warning" />
        <span className="min-w-0 flex-1 truncate text-left">
          {sampleOnly
            ? 'Sample copy — ask the agent to write your story'
            : `${issues.length} ${issues.length === 1 ? 'thing' : 'things'} to fix — ask the agent in chat`}
        </span>
        <ChevronDown data-icon="inline-end" className={open ? 'rotate-180' : undefined} />
      </Button>
      {open && (
        <ul aria-label="Composition issues" className="space-y-1 px-3 pb-2.5 text-text-soft">
          {issues.map((issue) => (
            <li key={issue} className="break-words">
              {issue}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Finished renders as a quiet row of chips: play in place, download. Hidden until one exists. */
export function RenderStrip({
  sessionId,
  project,
  viewing,
  onView,
}: {
  sessionId: string
  project: MotionProject
  viewing: string | null
  onView: (file: string | null) => void
}) {
  if (!project.renders.length) return null
  return (
    <section aria-label="Renders" className="space-y-1.5">
      <h2 className="text-2xs font-medium text-text-faint">Renders</h2>
      <div className="flex flex-wrap gap-1.5">
        {newestFirst(project.renders).map((render) => {
          const file = projectFile(project, render, 'renders')
          const active = viewing === file
          return (
            <div
              key={render.path}
              className="flex items-center gap-0.5 rounded-md border border-border-soft pr-0.5"
            >
              <Button
                size="sm"
                variant="ghost"
                aria-pressed={active}
                onClick={() => onView(active ? null : file)}
              >
                <Play data-icon="inline-start" />
                <span className="max-w-48 truncate">{render.name}</span>
                <span className="text-text-faint">
                  {formatFileSize(render.bytes)} · {formatTimeAgo(Date.parse(render.updatedAt))}
                </span>
              </Button>
              <Button asChild variant="ghost" size="icon-sm">
                <a
                  href={projectFileUrl(sessionId, project, file)}
                  download={render.name}
                  aria-label={`Download ${render.name}`}
                >
                  <Download />
                </a>
              </Button>
            </div>
          )
        })}
      </div>
    </section>
  )
}

const stillTime = (name: string) => name.match(/at-([\d.]+)s/u)?.[1]

/** The agent's latest review stills as a filmstrip, labelled by film time. */
export function StillStrip({ sessionId, project }: { sessionId: string; project: MotionProject }) {
  const stills = project.snapshots
    .filter((still) => !still.name.startsWith('contact-sheet'))
    .sort((a, b) => Number(stillTime(a.name) ?? 0) - Number(stillTime(b.name) ?? 0))
  if (!stills.length) return null
  return (
    <section aria-label="Review stills" className="space-y-1.5">
      <h2 className="text-2xs font-medium text-text-faint">Review stills</h2>
      <ul className="flex gap-2 overflow-x-auto pb-1">
        {stills.map((still) => (
          <Still key={still.path} sessionId={sessionId} project={project} still={still} />
        ))}
      </ul>
    </section>
  )
}

function Still({
  sessionId,
  project,
  still,
}: {
  sessionId: string
  project: MotionProject
  still: MotionFile
}) {
  const url = projectFileUrl(sessionId, project, projectFile(project, still, 'snapshots'))
  const time = stillTime(still.name)
  return (
    <li className="w-36 shrink-0">
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        aria-label={`Open still${time ? ` at ${time} s` : ''}`}
        className="block overflow-hidden rounded-sm bg-foreground/[0.04] outline-none focus-ring"
      >
        <img
          src={url}
          alt=""
          loading="lazy"
          className="block h-auto w-full object-cover"
          style={{ aspectRatio: `${project.width} / ${project.height}` }}
        />
      </a>
      {time && <span className="mt-0.5 block text-2xs text-text-faint">{time} s</span>}
    </li>
  )
}
