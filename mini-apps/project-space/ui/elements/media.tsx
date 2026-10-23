import type { SyntheticEvent } from 'react'
import { ExternalLink, FileType2, Globe, Image as ImageIcon } from 'lucide-react'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { miniAppExternal, miniAppWorkspace } from '@localixai/mini-app-sdk/ui/runtime'
import { fileIcon } from '@localixai/kit/file-icon'
import { IconButton } from '@localixai/kit/icon-button'
import { Popover, PopoverAnchor, PopoverContent } from '@localixai/kit/popover'
import { baseName, type ImageFit } from '../../shared/types/references'
import { spaceApi } from '../api'
import { defineView, type ElementViewProps } from './contract'
import { imageFitControl } from './controls'
import { Gone } from './files'
import { LinkForm, WebLink } from './WebLink'

/**
 * Images, documents and web links. A PDF previews in the webview's own viewer; the other office
 * formats show their name and open in the app's document viewer — a board is a map of the files,
 * not a second office suite. The embedded PDF takes the pointer only while it is open for editing
 * (a double-click), so the element can still be dragged by any part of it.
 */
type ImageProps = { path?: string; url?: string; alt: string; fit: ImageFit; source?: string }

/** Proportions closer than this are the same: a pixel of rounding must not start a resize. */
const ASPECT_TOLERANCE = 0.01

/**
 * The picture and nothing around it. A picture shown whole takes its own proportions the first
 * time it loads — the box it was dropped with is a guess, and `object-contain` letterboxed the
 * difference into bands that read as a frame; a picture that fills its box (`cover`) keeps the
 * box and crops instead, which is what a background is.
 */
function ImageView({
  props,
  sessionId,
  stamp,
  missing,
  width,
  height,
  resize,
}: ElementViewProps<ImageProps>) {
  if (missing) return <Gone what="This image" />
  const onLoad = (event: SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth, naturalHeight } = event.currentTarget
    if (props.fit !== 'contain' || !naturalWidth || !naturalHeight) return
    const aspect = naturalWidth / naturalHeight
    if (Math.abs(width / height - aspect) / aspect > ASPECT_TOLERANCE)
      resize({ w: width, h: Math.round(width / aspect) })
  }
  return (
    <img
      src={props.url ?? spaceApi.rawUrl(sessionId, props.path ?? '', String(stamp))}
      alt={props.alt || baseName(props.path ?? props.url ?? '')}
      draggable={false}
      decoding="async"
      onLoad={onLoad}
      className={cn(
        'block h-full w-full select-none',
        props.fit === 'cover' ? 'object-cover' : props.source ? 'object-contain' : 'object-fill',
      )}
    />
  )
}

type DocumentProps = { path: string }

function DocumentView({
  props,
  sessionId,
  stamp,
  missing,
  editing,
}: ElementViewProps<DocumentProps>) {
  const { Icon, color } = fileIcon(baseName(props.path))
  const pdf = props.path.toLowerCase().endsWith('.pdf')
  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-border-soft px-3 py-1.5">
        <Icon className={cn('size-3.5 shrink-0', color)} />
        <span className="min-w-0 truncate text-2xs text-text-soft" title={props.path}>
          {baseName(props.path)}
        </span>
      </div>
      {missing ? (
        <Gone what="This document" />
      ) : pdf ? (
        <iframe
          title={baseName(props.path)}
          src={spaceApi.rawUrl(sessionId, props.path, String(stamp))}
          // Scrolled only once entered (double-click); at rest the wheel moves the board.
          className={cn(
            'min-h-0 w-full flex-1 border-0',
            editing ? 'nowheel' : 'pointer-events-none',
          )}
        />
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-1 p-3 text-center text-2xs text-text-faint">
          <Icon className={cn('size-8', color)} />
          Open it to read it
        </div>
      )}
    </div>
  )
}

type LinkProps = { url: string; title: string }

function LinkView({ props, editing, commit, stopEditing }: ElementViewProps<LinkProps>) {
  const host = (() => {
    try {
      return new URL(props.url).host
    } catch {
      return props.url
    }
  })()
  return (
    <Popover
      open={editing}
      onOpenChange={(open) => {
        if (!open) stopEditing()
      }}
    >
      <PopoverAnchor asChild>
        <div className="flex h-full w-full items-center gap-2 px-3">
          <Globe aria-hidden className="size-4 shrink-0 text-text-faint" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-medium text-foreground">
              {props.title || host}
            </div>
            <div className="truncate text-3xs text-text-faint">
              <WebLink url={props.url}>{props.url}</WebLink>
            </div>
          </div>
          <IconButton
            size="sm"
            className="nodrag shrink-0"
            aria-label={`Open website: ${host}`}
            tooltip="Open website"
            onClick={(event) => {
              event.stopPropagation()
              void miniAppExternal.open(props.url)
            }}
            onDoubleClick={(event) => event.stopPropagation()}
          >
            <ExternalLink className="size-3.5" />
          </IconButton>
        </div>
      </PopoverAnchor>
      <PopoverContent
        className="nodrag w-80 p-3"
        side="bottom"
        onDoubleClick={(event) => event.stopPropagation()}
      >
        <LinkForm
          url={props.url}
          title={props.title}
          onSave={(next) => {
            commit(next)
            stopEditing()
          }}
          onCancel={stopEditing}
        />
      </PopoverContent>
    </Popover>
  )
}

export const mediaViews = [
  defineView({
    type: 'image',
    View: ImageView,
    Icon: ImageIcon,
    chrome: 'bare',
    keepAspect: (props: ImageProps) => props.fit === 'contain',
    controls: [imageFitControl],
    open: (props: ImageProps, sessionId: string) => {
      if (props.url) void miniAppExternal.open(props.url)
      else if (props.path) miniAppWorkspace.openFile({ sessionId, path: props.path })
    },
  }),
  defineView({
    type: 'document',
    View: DocumentView,
    Icon: FileType2,
    chrome: 'card',
    // Double-click lets a PDF take the pointer, to scroll and select in it.
    editable: true,
    open: (props: DocumentProps, sessionId: string) =>
      miniAppWorkspace.openFile({ sessionId, path: props.path }),
  }),
  defineView({
    type: 'link',
    View: LinkView,
    Icon: Globe,
    editable: true,
    chrome: 'card',
    open: (props: LinkProps) => void miniAppExternal.open(props.url),
    insert: { order: 6, description: 'Add a website with a visible open action', input: 'link' },
  }),
]
