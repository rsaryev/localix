import { useEffect, useRef, useState } from 'react'
import { FileText, MoreHorizontal } from 'lucide-react'
import { SelectionTile } from '@localixai/kit/selection-tile'
import { DocumentThumbnail } from '@localixai/kit/document-thumbnail'
import { IconButton } from '@localixai/kit/icon-button'
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from '@localixai/kit/context-menu'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@localixai/kit/dropdown-menu'
import { MenuEntries } from '@localixai/kit/menu-entries'
import type { MenuEntry } from '@localixai/plugin-sdk/ui'
import type { ResumeDocument, ResumeSummary } from '../shared/schema'
import { resumeApi } from './api'
import { Preview } from './Preview'

export function ResumeCard({
  resume,
  sessionId,
  onOpen,
  entries,
  disabled,
}: {
  resume: ResumeSummary
  sessionId: string
  onOpen: () => void
  entries: MenuEntry[]
  disabled: boolean
}) {
  const root = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const [preview, setPreview] = useState<ResumeDocument | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    const node = root.current
    if (!node) return
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true)
      return
    }
    const observer = new IntersectionObserver(
      (items) => {
        if (items.some((item) => item.isIntersecting)) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { rootMargin: '200px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (!visible) return
    let live = true
    setFailed(false)
    void resumeApi.get(sessionId, resume.id).then(
      (record) => {
        if (live) setPreview(record.document)
      },
      () => {
        if (live) setFailed(true)
      },
    )
    return () => {
      live = false
    }
  }, [visible, sessionId, resume.id, resume.revision])
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div ref={root} className="group relative min-w-0">
          <SelectionTile
            aria-pressed={undefined}
            aria-label={`Open ${resume.title}`}
            disabled={disabled}
            onClick={onOpen}
            className="w-full p-0"
          >
            <div className="h-48 w-full overflow-hidden bg-surface-hover p-3">
              {preview ? (
                <DocumentThumbnail className="rounded-sm">
                  <Preview document={preview} />
                </DocumentThumbnail>
              ) : (
                <div className="flex h-full items-center justify-center text-text-faint">
                  <FileText className="size-6" />
                  <span className="sr-only">
                    {failed ? 'Preview unavailable' : 'Loading preview'}
                  </span>
                </div>
              )}
            </div>
            <div className="w-full space-y-1 px-3 py-3 pr-10">
              <div className="truncate text-sm font-medium text-text-strong">{resume.title}</div>
              <div className="text-xs text-text-faint">
                Edited {new Date(resume.updatedAt).toLocaleDateString()}
              </div>
            </div>
          </SelectionTile>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton
                aria-label={`Actions for ${resume.title}`}
                size="sm"
                disabled={disabled}
                className="absolute bottom-4 right-2 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
              >
                <MoreHorizontal />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <MenuEntries entries={entries} family="dropdown" />
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <MenuEntries entries={entries} family="context" />
      </ContextMenuContent>
    </ContextMenu>
  )
}
