import { useEffect, useState, type SyntheticEvent } from 'react'
import {
  contextBindingFilePath,
  contextBindingMediaId,
  contextBindingImageMimeType,
  contextBindingPreviewKind,
  type MiniAppContextBindingIconProps,
  type MiniAppContextBindingPreviewProps,
} from '@localixai/mini-app-sdk/ui'

import { conversationPreview } from './binding-previews/LinkPreviews'
import { refIcon } from '@/entities/chat/ui/refKindPresentation'
import { backendClient } from '@/shared/api/client'
import { fileIcon } from '@/shared/ui/file-icon/fileIcon'
import { mediaSrc } from '@/shared/lib/mediaSrc'
import { apiFetch } from '@/shared/api/internal'

export function MiniAppContextBindingIcon({ binding, className }: MiniAppContextBindingIconProps) {
  'use no memo'
  if (binding.target.kind === 'file') {
    const path = binding.target.attributes?.path
    const { Icon, color } = fileIcon(typeof path === 'string' ? path : binding.target.label)
    return <Icon className={[className, color].filter(Boolean).join(' ')} />
  }
  const Icon = refIcon({ kind: binding.target.kind, uri: binding.target.uri })
  // oxlint-disable-next-line react/static-components -- `refIcon` looks the icon up in a static table; its identity never changes between renders
  return <Icon className={className} />
}

type BindingPreviewState =
  | { key: string; kind: 'image'; src: string }
  | { key: string; kind: 'text'; text: string }
  | { key: string; kind: 'unavailable' }

/**
 * The host's preview of any link: a file as its picture or its first lines, and a link into the
 * conversation — a session, a message, a tool call, a project — as the chat draws it
 * (`binding-previews/LinkPreviews.tsx`). Kinds with nothing to show beyond their name render
 * nothing, and the caller's own label stands alone.
 */
export function MiniAppContextBindingPreview(props: MiniAppContextBindingPreviewProps) {
  'use no memo'
  const Conversation = conversationPreview(props.binding.target.kind)
  // oxlint-disable-next-line react/static-components -- `conversationPreview` returns one module-level component per link kind
  if (Conversation) return <Conversation binding={props.binding} className={props.className} />
  return <FileBindingPreview {...props} />
}

function FileBindingPreview({
  binding,
  sessionId,
  className,
  onIntrinsicSize,
}: MiniAppContextBindingPreviewProps) {
  'use no memo'
  // `sessionId` is the caller's chat, as it says: a path is read from THAT workspace. Filling a
  // missing one with the chat on screen previewed a same-named file from another project.
  const path = contextBindingFilePath(binding)
  const mediaId = contextBindingMediaId(binding)
  const previewKind = contextBindingPreviewKind(binding)
  const fallbackMimeType = contextBindingImageMimeType(binding)
  // What a stored state answers: a new target, kind or fallback type is a new question, so an
  // old answer stops matching without any state being reset from an effect.
  const target = mediaId ? `media\0${mediaId}` : `${sessionId ?? ''}\0${path ?? ''}`
  const key = `${target}\0${previewKind ?? ''}\0${fallbackMimeType ?? ''}`
  const [stored, setState] = useState<BindingPreviewState>({ key: '', kind: 'unavailable' })
  // A stored media image needs no request: its address is known while rendering. Only a failed
  // load (recorded under the same key) takes it back.
  const mediaImage =
    mediaId && previewKind === 'image'
      ? {
          key,
          kind: 'image' as const,
          src: mediaSrc({ mediaType: fallbackMimeType ?? '', mediaId }),
        }
      : null
  const state: BindingPreviewState =
    mediaImage && !(stored.key === key && stored.kind === 'unavailable') ? mediaImage : stored

  useEffect(() => {
    if (!previewKind || (!mediaId && (!path || !sessionId))) return
    if (mediaId && previewKind === 'image') return
    const controller = new AbortController()
    const content = mediaId
      ? apiFetch(mediaSrc({ mediaType: fallbackMimeType ?? '', mediaId }), {
          signal: controller.signal,
        }).then(async (response) => {
          if (!response.ok) throw new Error(`media preview failed (${response.status})`)
          return {
            content: await response.text(),
            encoding: 'utf8' as const,
            truncated: false,
            mimeType: response.headers.get('content-type') ?? undefined,
          }
        })
      : backendClient.getFileContent(sessionId!, path!, { signal: controller.signal })
    void content
      .then((response) => {
        if (response.truncated) {
          setState({ key, kind: 'unavailable' })
          return
        }
        const mimeType = response.mimeType?.startsWith('image/')
          ? response.mimeType
          : fallbackMimeType
        if (previewKind === 'image' && mimeType) {
          const src =
            response.encoding === 'base64'
              ? `data:${mimeType};base64,${response.content}`
              : `data:${mimeType};utf8,${encodeURIComponent(response.content)}`
          setState({ key, kind: 'image', src })
          return
        }
        if (previewKind === 'text' && response.encoding !== 'base64') {
          setState({ key, kind: 'text', text: response.content.slice(0, 900) })
          return
        }
        setState({ key, kind: 'unavailable' })
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ key, kind: 'unavailable' })
      })
    return () => controller.abort()
  }, [fallbackMimeType, key, mediaId, path, previewKind, sessionId])

  const classes = [className, 'lx-binding-preview'].filter(Boolean).join(' ')
  if (state.key === key && state.kind === 'image') {
    return (
      <div className={`${classes} is-image`}>
        <img
          src={state.src}
          alt={binding.target.label}
          draggable={false}
          onLoad={(event: SyntheticEvent<HTMLImageElement>) => {
            const image = event.currentTarget
            if (image.naturalWidth && image.naturalHeight) {
              onIntrinsicSize?.({ width: image.naturalWidth, height: image.naturalHeight })
            }
          }}
          onError={() => setState({ key, kind: 'unavailable' })}
        />
      </div>
    )
  }
  if (state.key === key && state.kind === 'text') {
    return <pre className={`${classes} is-text`}>{state.text}</pre>
  }
  if (previewKind && (mediaId || sessionId) && state.key !== key) {
    return (
      <div
        className={`${classes} is-loading`}
        aria-label={`Loading preview for ${binding.target.label}`}
      />
    )
  }
  if (previewKind === 'image') {
    return (
      <div className={`${classes} is-unavailable`}>
        <MiniAppContextBindingIcon binding={binding} className="lx-binding-preview-icon" />
      </div>
    )
  }
  return null
}
