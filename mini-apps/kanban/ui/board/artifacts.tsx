import { FileText, Link2, Terminal, StickyNote, type LucideIcon } from 'lucide-react'
import { miniAppTerminal, miniAppWorkspace } from '@localixai/mini-app-sdk/ui/runtime'
import { Chip } from '@localixai/kit/chip'
import { ExternalAnchor } from '@localixai/kit/external-anchor'
import { TextAction } from '@localixai/kit/text-action'
import { useWorkItemSessionId } from '@localixai/mini-app-sdk/ui/work-item-session'

import type { KanbanArtifact, KanbanArtifactKind } from '../../shared/contracts'

/** A file or command payload that acts when clicked — a monospace line, not a control. */
const ARTIFACT_LINK =
  'mt-0.5 block w-full truncate font-mono text-2xs text-text-soft hover:text-foreground hover:underline'

const KIND_ICON: Record<KanbanArtifactKind, LucideIcon> = {
  file: FileText,
  url: Link2,
  command: Terminal,
  note: StickyNote,
}

/**
 * Renders a task's structured deliverables (the machine-readable handoff). Kind-agnostic: each
 * row shows a kind chip, the payload (`value`) and an optional title and description. A URL is a
 * link, a file opens in the editor, and a command is offered to the terminal.
 *
 * Both of those act in the chat whose board this is — the tab's own (`useWorkItemSessionId`). The
 * file and the terminal used to be whichever chat was in front, so a card of chat A opened its file
 * in chat B's workspace and pasted its command into B's shell. Outside a chat's tab there is no
 * workspace to act in, and the payload is shown as plain text.
 */
export function ArtifactList({ artifacts }: { artifacts: KanbanArtifact[] }) {
  const sessionId = useWorkItemSessionId()
  if (artifacts.length === 0) return null
  const artifactKeyOccurrences = new Map<string, number>()
  const keyedArtifacts = artifacts.map((artifact) => {
    const base = `${artifact.kind}:${artifact.value}:${artifact.title ?? ''}:${artifact.description ?? ''}`
    const occurrence = (artifactKeyOccurrences.get(base) ?? 0) + 1
    artifactKeyOccurrences.set(base, occurrence)
    return {
      artifact,
      key: occurrence === 1 ? base : `${base}:duplicate-${occurrence}`,
    }
  })
  return (
    <div className="flex flex-col gap-1.5">
      {keyedArtifacts.map(({ artifact: a, key }) => {
        const Icon = KIND_ICON[a.kind] ?? FileText
        const mono = a.kind === 'file' || a.kind === 'command'
        return (
          <div
            key={key}
            className="flex items-start gap-2 rounded-lg border border-border-soft px-2.5 py-2"
          >
            <Icon className="mt-0.5 size-3.5 shrink-0 text-text-faint" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <Chip size="dense" className="uppercase">
                  {a.kind}
                </Chip>
                {a.title && (
                  <span className="truncate text-xs font-medium text-foreground">{a.title}</span>
                )}
              </div>
              {a.kind === 'url' ? (
                <ExternalAnchor
                  href={a.value}
                  className="mt-0.5 block truncate text-2xs text-status-info hover:underline"
                  title={a.value}
                >
                  {a.value}
                </ExternalAnchor>
              ) : sessionId && a.kind === 'file' ? (
                <TextAction
                  onClick={() => miniAppWorkspace.openFile({ sessionId, path: a.value })}
                  tooltip={`Open ${a.value}`}
                  className={ARTIFACT_LINK}
                >
                  {a.value}
                </TextAction>
              ) : sessionId && a.kind === 'command' ? (
                <TextAction
                  // Pasted, never run: the person reads the line on the prompt and presses Enter.
                  onClick={() => miniAppTerminal.paste({ sessionId, command: a.value })}
                  tooltip={`Paste into the terminal: ${a.value}`}
                  className={ARTIFACT_LINK}
                >
                  {a.value}
                </TextAction>
              ) : (
                <div
                  className={`mt-0.5 truncate text-2xs text-text-soft ${mono ? 'font-mono' : ''}`}
                  title={a.value}
                >
                  {a.value}
                </div>
              )}
              {a.description && (
                <div className="mt-0.5 text-2xs text-text-faint">{a.description}</div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
