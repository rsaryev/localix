import { ExternalLink, GripVertical, Link2 } from 'lucide-react'
import {
  ContextBindingIcon,
  ContextBindingPreview,
  localixUriNamespace,
  setMessageBindingDrag,
  type MessageContextBindingDraft,
} from '@localixai/mini-app-sdk/ui'
import { miniAppNavigation } from '@localixai/mini-app-sdk/ui/runtime'
import { useZoomBelow } from '@localixai/kit/canvas'
import { linksInText } from '@localixai/kit/context-links'
import { IconButton } from '@localixai/kit/icon-button'
import type { RefProps } from '../../shared/types/app-links'
import { CARD_TITLE_PX } from './CardTitle'
import { defineView, type ElementViewProps } from './contract'

/**
 * An app link on the board: the thing's own glyph and name, what KIND of thing it is, and — below —
 * the thing itself as the host draws it (`ContextBindingPreview`): a session's state and last
 * word, a message, the transcript's card for a tool call. Nothing here imitates the chat; a kind
 * the host has no picture for shows its token, which is still a link that opens.
 *
 * The link goes both ways: Open takes the person to it, and the grip drags it back out — into the
 * composer, where it is the same `@`-link it was when it was dragged in.
 */
const FAR = 0.45

const KIND_NAMES: Record<string, string> = {
  session: 'Session',
  message: 'Message',
  call: 'Tool call',
  terminal: 'Terminal',
  project: 'Project',
  resource: 'Resource',
  file: 'File',
}

/**
 * The link the element stores, as the binding the host draws and opens. A link the agent wrote
 * with only its token (`@session:LOCALIX-42`) is completed from that token by the host's own
 * grammar, so the agent never has to spell out the attributes a drag would have carried.
 */
export function linkOf(props: RefProps): MessageContextBindingDraft {
  const parsed = props.token && !props.attributes ? linksInText(props.token).links[0] : undefined
  const attributes = props.attributes ?? parsed?.target.attributes
  const uri = props.uri ?? parsed?.target.uri
  return {
    kind: 'context',
    source: 'drag',
    ...(props.miniApp ? { miniApp: props.miniApp } : {}),
    target: {
      kind: props.kind as MessageContextBindingDraft['target']['kind'],
      token: props.token,
      label: props.label,
      ...(uri ? { uri } : {}),
      ...(attributes ? { attributes } : {}),
    },
  }
}

/** "Session", or for a resource the provider that owns it: "database", "git", "vault". */
function kindName(props: RefProps): string {
  if (props.kind === 'resource' && props.uri) return localixUriNamespace(props.uri) ?? 'Resource'
  return KIND_NAMES[props.kind] ?? props.kind
}

function AppLinkView({ props, sessionId }: ElementViewProps<RefProps>) {
  const far = useZoomBelow(FAR)
  const link = linkOf(props)
  const name = props.label || props.token || props.uri || kindName(props)
  return (
    <div className="flex h-full w-full flex-col">
      <div
        className="flex shrink-0 items-center gap-2 border-b border-border-soft pl-3 pr-1"
        style={{ height: CARD_TITLE_PX }}
      >
        <ContextBindingIcon binding={link} className="size-3.5 shrink-0 text-text-soft" />
        <span
          className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground"
          title={name}
        >
          {name}
        </span>
        <span className="shrink-0 rounded-sm bg-foreground/[0.06] px-1.5 text-3xs text-text-faint">
          {kindName(props)}
        </span>
        <span
          role="button"
          tabIndex={-1}
          aria-label={`Drag ${name} into the chat`}
          title="Drag into the chat"
          draggable
          onDragStart={(event) => {
            event.stopPropagation()
            setMessageBindingDrag(
              event.dataTransfer,
              link,
              props.token ? { plainText: props.token } : undefined,
            )
          }}
          className="nodrag flex size-6 shrink-0 cursor-grab items-center justify-center rounded-sm text-text-faint hover:text-foreground active:cursor-grabbing"
        >
          <GripVertical className="size-3.5" />
        </span>
        <IconButton
          size="sm"
          aria-label={`Open ${name}`}
          tooltip="Open"
          className="nodrag shrink-0"
          onClick={(event) => {
            event.stopPropagation()
            void openLink(props, sessionId)
          }}
        >
          <ExternalLink className="size-3" />
        </IconButton>
      </div>
      {!far && (
        <div className="nowheel min-h-0 flex-1 overflow-hidden">
          <ContextBindingPreview binding={link} sessionId={sessionId} className="h-full w-full" />
          {!hasPreview(props.kind) && (
            <p className="truncate px-3 py-2 font-mono text-3xs text-text-faint">
              {props.uri ?? props.token}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

/** Kinds the host draws a picture of; the rest show their token under the name. */
const hasPreview = (kind: string) =>
  ['session', 'message', 'call', 'project', 'file'].includes(kind)

const openLink = (props: RefProps, sessionId: string) =>
  miniAppNavigation.openBinding(linkOf(props), sessionId)

export const appLinkViews = [
  defineView<RefProps>({
    type: 'ref',
    View: AppLinkView,
    Icon: Link2,
    chrome: 'card',
    open: (props, sessionId) => void openLink(props, sessionId),
  }),
]
