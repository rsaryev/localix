import { ExternalLink, FolderOpen, Repeat2, X } from 'lucide-react'
import { miniAppWorkspace } from '@localixai/mini-app-sdk/ui/runtime'
import { Button } from '@localixai/kit/button'
import { IconButton } from '@localixai/kit/icon-button'
import { TextAction } from '@localixai/kit/text-action'
import { location } from '../../shared/format'
import { dirId, fileId, parentPath } from '../../shared/ids'
import type { GraphSnapshot, NodeDetail, NodeSummaryView } from '../../shared/view'
import { canOpen, KIND_ICON, KIND_LABEL, KIND_TINT } from '../kinds'
import { Relations, Row } from './Relations'

/**
 * The side panel. With nothing selected it describes the LEVEL you are standing in — what it holds,
 * what inside it everything leans on, where its imports go in circles — so entering a folder is
 * also reading about it. With a node selected it describes that node and offers what to do next.
 */
export function Inspector({
  sessionId,
  snapshot,
  detail,
  isLevel,
  onJump,
  onEnter,
  onClear,
}: {
  /** The chat the map belongs to — where "Open" opens the source. */
  sessionId: string
  snapshot: GraphSnapshot
  detail: NodeDetail
  /** The detail is the current level, not a selection. */
  isLevel: boolean
  onJump: (node: Pick<NodeSummaryView, 'id' | 'kind' | 'path' | 'parent'>) => void
  onEnter: (id: string) => void
  onClear: () => void
}) {
  const { node } = detail
  const Icon = KIND_ICON[node.kind]
  const hasSource = node.kind !== 'directory' && node.kind !== 'package'
  // Hotspots and cycles describe a level that holds files; in the call lens the level is a function.
  const isContainer = isLevel && (node.kind === 'directory' || node.kind === 'file')
  return (
    <div className="flex flex-col gap-5 p-4">
      <header className="flex items-start gap-2.5">
        <Icon aria-hidden className={`mt-0.5 size-4 shrink-0 ${KIND_TINT[node.kind]}`} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold text-foreground" title={node.name}>
            {node.name}
          </h2>
          <p className="truncate text-2xs text-text-faint" title={location(node)}>
            {KIND_LABEL[node.kind]} · {location(node)}
          </p>
        </div>
        {!isLevel && (
          <IconButton
            aria-label="Back to this level"
            tooltip="Back to this level  Esc"
            size="xs"
            onClick={onClear}
          >
            <X className="size-3" />
          </IconButton>
        )}
      </header>

      <dl className="grid grid-cols-3 divide-x divide-border-faint rounded-lg border border-border-faint">
        <Metric label="used by" value={node.dependents} />
        <Metric label="uses" value={node.dependencies} />
        <Metric
          label={node.kind === 'directory' ? 'files' : hasSource ? 'impact' : 'size'}
          value={node.kind === 'directory' ? node.size : hasSource ? detail.impactFiles : node.size}
        />
      </dl>

      {/* No "add to chat" action: the tab publishes what it shows as the chat's context and
          replaces it as you move, the host's standard for a workbench surface. */}
      {(hasSource || (!isLevel && canOpen(node.kind))) && (
        <div className="flex flex-wrap gap-1.5">
          {hasSource && (
            <Button
              size="sm"
              variant="field"
              onClick={() =>
                miniAppWorkspace.openFile({
                  sessionId,
                  path: `${snapshot.root}/${node.path}`,
                  ...(node.line && node.kind !== 'file' ? { line: node.line } : {}),
                })
              }
            >
              <ExternalLink className="size-3" /> Open
            </Button>
          )}
          {!isLevel && canOpen(node.kind) && (
            <Button size="sm" variant="field" onClick={() => onEnter(node.id)}>
              <FolderOpen className="size-3" /> Explore
            </Button>
          )}
        </div>
      )}

      {isContainer && snapshot.hubs && snapshot.hubs.length > 0 && (
        <section className="flex flex-col gap-1">
          <h3 className="text-2xs font-medium text-text-soft">Most depended on here</h3>
          {snapshot.hubs.map((hub) => (
            <Row
              key={hub.id}
              // The hub's path below this level; on a file's own level the hub IS the file, and
              // cutting its own path off left an empty row.
              node={{
                ...hub,
                name:
                  hub.path === node.path
                    ? hub.name
                    : hub.path.slice(node.path ? node.path.length + 1 : 0),
              }}
              trailing={`${hub.dependents}`}
              onJump={onJump}
            />
          ))}
        </section>
      )}

      {isContainer && snapshot.cycles && snapshot.cycles.length > 0 && (
        <section className="flex flex-col gap-1">
          <h3 className="text-2xs font-medium text-text-soft">Import cycles</h3>
          {snapshot.cycles.map((cycle) => {
            const first = cycle[0]?.slice('file:'.length) ?? ''
            return (
              <TextAction
                key={cycle.join('|')}
                className="-mx-1.5 flex w-[calc(100%+0.75rem)] items-center gap-1.5 rounded-md px-1.5 py-1 text-2xs text-text-soft hover:bg-surface-hover hover:text-foreground"
                tooltip={cycle.map((id) => id.slice('file:'.length)).join('\n')}
                onClick={() =>
                  onJump({
                    id: fileId(first),
                    kind: 'file',
                    path: first,
                    parent: dirId(parentPath(first)),
                  })
                }
              >
                <Repeat2 aria-hidden className="size-3 shrink-0 text-status-warning" />
                <span className="min-w-0 flex-1 truncate">{first}</span>
                <span className="shrink-0 font-mono text-3xs text-text-faint">
                  {cycle.length} files
                </span>
              </TextAction>
            )
          })}
        </section>
      )}

      <Relations
        title="Uses"
        relations={detail.outgoing}
        more={detail.moreOutgoing}
        direction="out"
        onJump={onJump}
      />
      <Relations
        title="Used by"
        relations={detail.incoming}
        more={detail.moreIncoming}
        direction="in"
        onJump={onJump}
      />
    </div>
  )
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col items-center py-2">
      <dd className="text-sm font-semibold text-foreground tabular-nums">
        {value.toLocaleString()}
      </dd>
      <dt className="text-3xs text-text-faint">{label}</dt>
    </div>
  )
}
