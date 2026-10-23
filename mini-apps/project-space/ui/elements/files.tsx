import { Code2, ExternalLink, FileText, Folder } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { miniAppWorkspace } from '@localixai/mini-app-sdk/ui/runtime'
import { useZoomBelow } from '@localixai/kit/canvas'
import { languageFromPath } from '@localixai/kit/diff'
import { fileIcon, folderIcon } from '@localixai/kit/file-icon'
import { IconButton } from '@localixai/kit/icon-button'
import { baseName } from '../../shared/types/references'
import { spaceApi } from '../api'
import { CardTitle } from './CardTitle'
import { CodeArea } from './CodeArea'
import { CodeLines } from './CodeLines'
import { defineView, type ElementViewProps } from './contract'
import { codeLanguageControl } from './controls'
import { codeHighlighter } from './highlight'
import { useFetched } from './useFetched'

/**
 * Code kept on the board, and the file and folder references. A reference card reads like a file
 * in an editor tab: its NAME first (the path is the folder under it, not a wall of directories),
 * what it holds now below, how long and how recent in the footer. Far away the body is dropped —
 * below 45 % no line of code is readable, and hundreds of highlighted previews are what makes a
 * large board slow to move.
 */
const FAR = 0.45

export function Gone({ what }: { what: string }) {
  return (
    <div className="flex flex-1 items-center justify-center p-4 text-center text-2xs text-status-warning">
      {what} is not there any more — point the card at its new path or delete it.
    </div>
  )
}

/** "src/auth/" under "login.ts", with a home directory shortened the way a terminal does. */
function folderOf(path: string) {
  const parts = path.replace(/\/+$/u, '').split('/')
  parts.pop()
  const folder = parts.join('/')
  return folder.replace(/^\/Users\/[^/]+/u, '~') || (path.startsWith('/') ? '/' : '')
}

function ago(stamp: number) {
  if (!stamp) return ''
  const minutes = Math.round((Date.now() - stamp) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  return new Date(stamp).toLocaleDateString()
}

function CardHeader({
  icon,
  name,
  folder,
  onOpen,
}: {
  icon: ReactNode
  name: string
  folder: string
  onOpen: () => void
}) {
  return (
    <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border-soft px-3">
      {icon}
      <div className="min-w-0 flex-1 leading-tight">
        <div className="truncate text-xs font-semibold text-foreground">{name}</div>
        {folder && (
          <div className="truncate font-mono text-3xs text-text-faint" title={folder}>
            {folder}
          </div>
        )}
      </div>
      <IconButton
        aria-label="Open in the editor"
        tooltip="Open in the editor"
        size="xs"
        className="nodrag"
        onClick={onOpen}
      >
        <ExternalLink className="size-3" />
      </IconButton>
    </div>
  )
}

type CodeProps = { code: string; language: string; title: string }

function CodeView({ props, editing, commit, stopEditing }: ElementViewProps<CodeProps>) {
  return (
    <div className="flex h-full w-full flex-col">
      <CardTitle
        Icon={Code2}
        title={props.title || 'Snippet'}
        badge={props.language || undefined}
      />
      {/* The wheel over a card moves the BOARD, as in every whiteboard: `nowheel` (the wheel
          scrolls this box instead) only while the snippet is open for editing. On a card at rest
          it made a board you pan by scrolling stop dead under every code card. */}
      <div className={cn('min-h-0 flex-1', editing ? 'nowheel overflow-auto' : 'overflow-hidden')}>
        {editing ? (
          <CodeArea
            value={props.code}
            highlight={codeHighlighter(props.language || undefined)}
            onCommit={(code) => commit({ code })}
            onDone={stopEditing}
            gutter
            className="py-2 pr-3"
          />
        ) : (
          <CodeLines code={props.code} language={props.language || undefined} className="py-2" />
        )}
      </div>
    </div>
  )
}

type FileProps = { path: string; line?: number }

function FileView({ props, sessionId, stamp, missing }: ElementViewProps<FileProps>) {
  const far = useZoomBelow(FAR)
  const name = baseName(props.path)
  const { Icon, color } = fileIcon(name)
  const text = useFetched(`${props.path}\u0000${stamp}`, () => spaceApi.text(sessionId, props.path))
  const lines = text.data?.text ? text.data.text.replace(/\n$/u, '').split('\n').length : 0
  const open = () => openPath(props, sessionId)
  return (
    <div className="flex h-full w-full flex-col">
      <CardHeader
        icon={<Icon className={cn('size-4 shrink-0', color)} />}
        name={name}
        folder={folderOf(props.path)}
        onOpen={open}
      />
      {missing ? (
        <Gone what="This file" />
      ) : far ? (
        <div className="flex flex-1 items-center justify-center">
          <Icon className={cn('size-10 opacity-60', color)} />
        </div>
      ) : text.data?.binary ? (
        <div className="flex flex-1 items-center justify-center text-2xs text-text-faint">
          Binary file
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-hidden">
          <CodeLines
            code={text.data?.text ?? ''}
            language={languageFromPath(props.path)}
            className="py-2"
          />
        </div>
      )}
      {!missing && (
        <div
          data-detail="fine"
          className="flex h-7 shrink-0 items-center gap-2 border-t border-border-soft px-3 text-3xs text-text-faint"
        >
          {lines > 0 && (
            <span>
              {lines}
              {text.data?.truncated ? '+' : ''} lines
            </span>
          )}
          <span className="ml-auto">{ago(stamp)}</span>
        </div>
      )}
    </div>
  )
}

type FolderProps = { path: string }

function FolderView({ props, sessionId, stamp, missing }: ElementViewProps<FolderProps>) {
  const far = useZoomBelow(FAR)
  const listing = useFetched(`${props.path}\u0000${stamp}`, () =>
    spaceApi.folder(sessionId, props.path),
  )
  const { Icon, color } = folderIcon(true)
  return (
    <div className="flex h-full w-full flex-col">
      <CardHeader
        icon={<Icon className={cn('size-4 shrink-0', color)} />}
        name={`${baseName(props.path)}/`}
        folder={folderOf(props.path)}
        onOpen={() => openPath(props, sessionId)}
      />
      {missing ? (
        <Gone what="This folder" />
      ) : far ? (
        <div className="flex flex-1 items-center justify-center text-sm text-text-faint">
          {listing.data?.total ?? ''} items
        </div>
      ) : (
        <ul className="grid min-h-0 flex-1 auto-rows-min grid-cols-2 gap-x-2 overflow-hidden px-2 py-1.5">
          {listing.data?.entries.map((entry) => {
            const glyph = entry.kind === 'folder' ? folderIcon(false) : fileIcon(entry.name)
            return (
              <li
                key={entry.name}
                className="flex min-w-0 items-center gap-1.5 rounded-sm px-1 py-0.5 text-2xs text-text-soft"
              >
                <glyph.Icon className={cn('size-3 shrink-0', glyph.color)} />
                <span className="truncate">{entry.name}</span>
              </li>
            )
          })}
        </ul>
      )}
      {!missing && listing.data && (
        <div
          data-detail="fine"
          className="flex h-7 shrink-0 items-center border-t border-border-soft px-3 text-3xs text-text-faint"
        >
          {listing.data.total} items
        </div>
      )}
    </div>
  )
}

// Opened in the chat whose board this is (the `sessionId` the contract hands every `open`), never
// the one in front — a board kept open in another chat's tab put its files in that chat.
const openPath = (props: { path: string; line?: number }, sessionId: string) =>
  miniAppWorkspace.openFile({
    sessionId,
    path: props.path,
    ...(props.line ? { line: props.line } : {}),
  })

export const fileViews = [
  defineView({
    type: 'code',
    View: CodeView,
    Icon: Code2,
    editable: true,
    chrome: 'card',
    insert: { order: 5, key: 'c', description: 'Add a code snippet with syntax highlighting' },
    controls: [codeLanguageControl],
  }),
  defineView({ type: 'file', View: FileView, Icon: FileText, chrome: 'card', open: openPath }),
  defineView({ type: 'folder', View: FolderView, Icon: Folder, chrome: 'card', open: openPath }),
]
