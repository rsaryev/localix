import { useState } from 'react'
import { useNavigate } from 'react-router'
import { Check, ChevronRight, Copy, Layers, TriangleAlert } from 'lucide-react'
import type { MessageContextBinding } from '@/shared/api/contracts'
import { IconButton } from '@localixai/kit/icon-button'
import { SectionLabel } from '@localixai/kit/section-label'
import {
  Popover,
  PopoverBody,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@localixai/kit/popover'
import { cn } from '@localixai/plugin-sdk/ui/classes'
import { useCopied } from '@localixai/plugin-sdk/ui/interactions'
import { useUiNavigation } from '@/shared/hooks/useUiNavigation'
import { navigateUi } from '@/shared/lib/uiNavigation'
import { linkFromRef } from '../model/contextLinks'
import { refFromContextBinding } from '../model/sendRefs'
import { linkDragProps } from './linkDrag'
import { refDisplayLabel, refIcon, refOpenAction, useRefLabelSources } from './refKindPresentation'
import { anyContextNeedsAttention, contextStatus } from './contextStatus'

const bindingLabel = (binding: MessageContextBinding) => binding.target.label || binding.target.kind

/**
 * What a sent message carried as context: ONE quiet summary under the message, and the
 * inspector it opens.
 *
 * WHY ONE SUMMARY. The contexts used to be listed inline — first behind a native disclosure that
 * unfolded into bordered cards of raw JSON, then as a row of pills, one per context, with a
 * warning on the pill AND another on the trigger. A two-word message carried a line of four
 * labels longer than itself. The summary names the first context and counts the rest
 * (`Browser tabs +3`), with a single warning mark when any did not reach the model; everything
 * else — each context's outcome, opening it, dragging it on, its raw payload — is one click away.
 *
 * The summary reads the binding's own label, so a message mounts no store subscription: the
 * label lookups that resolve a session's or project's live name run inside the inspector, which
 * mounts only while it is open — the reason a long transcript stays cheap.
 */
export function MessageContextInspector({
  bindings,
  sessionId,
}: {
  bindings: readonly MessageContextBinding[]
  sessionId: string | null
}) {
  const [open, setOpen] = useState(false)
  // Host-owned context is runtime state, not something the user attached: the summary names and
  // counts only the user's own, and the inspector files the rest under the workspace. Showing it
  // as an attachment would expose an implementation detail and claim it was the user's choice.
  const attached = bindings.filter((binding) => binding.source !== 'system')
  const workspace = bindings.filter((binding) => binding.source === 'system')
  const lead = attached[0]
  if (bindings.length === 0) return null
  const LeadIcon = lead ? refIcon(refFromContextBinding(lead)) : Layers
  const attention = anyContextNeedsAttention(bindings)
  const rest = attached.length - 1
  const label = `Context sent with this message: ${bindings.length}${attention ? ', some not included' : ''}`

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          data-slot="message-context-summary"
          className="inline-flex h-(--chrome-control-xs) max-w-full min-w-0 items-center gap-1 rounded-md px-1.5 text-2xs text-text-faint outline-none transition-colors hover:bg-surface-hover hover:text-text-soft focus-ring aria-expanded:bg-surface-active aria-expanded:text-text-soft"
        >
          <LeadIcon className="size-3 shrink-0" />
          <span className="min-w-0 max-w-48 truncate">
            {lead ? bindingLabel(lead) : 'Workspace context'}
          </span>
          {rest > 0 && <span className="shrink-0 tabular-nums">+{rest}</span>}
          {attention && <TriangleAlert className="size-3 shrink-0 text-status-warning" />}
        </button>
      </PopoverTrigger>
      <PopoverContent layout="structured" align="end" className="w-[min(24rem,calc(100vw-2rem))]">
        <PopoverHeader className="py-2">
          <PopoverTitle>Context sent with this message</PopoverTitle>
        </PopoverHeader>
        <PopoverBody className="max-h-[min(26rem,60dvh)] p-1">
          {open && (
            <>
              <ContextRows bindings={attached} sessionId={sessionId} close={() => setOpen(false)} />
              {workspace.length > 0 && (
                <>
                  <SectionLabel
                    weight="semibold"
                    className={cn('px-2 pb-1', attached.length > 0 ? 'pt-3' : 'pt-1.5')}
                  >
                    From the workspace
                  </SectionLabel>
                  <ContextRows
                    bindings={workspace}
                    sessionId={sessionId}
                    close={() => setOpen(false)}
                  />
                </>
              )}
            </>
          )}
        </PopoverBody>
      </PopoverContent>
    </Popover>
  )
}

function ContextRows({
  bindings,
  sessionId,
  close,
}: {
  bindings: readonly MessageContextBinding[]
  sessionId: string | null
  close: () => void
}) {
  const navigate = useNavigate()
  const uiNavigation = useUiNavigation({ sessionId })
  const refs = bindings.map(refFromContextBinding)
  const labelSources = useRefLabelSources(refs)
  return (
    <ul className="flex flex-col">
      {bindings.map((binding, index) => {
        const ref = refs[index]!
        const reached = contextStatus(binding.resolution.status).tone !== 'attention'
        const open = reached
          ? refOpenAction(ref, {
              sessionId,
              navigate: (path) => void navigate(path),
              navigateUi: (uri) => void navigateUi(uri, uiNavigation),
            })
          : null
        return (
          <ContextRow
            key={binding.id}
            binding={binding}
            label={refDisplayLabel(ref, labelSources)}
            Icon={refIcon(ref)}
            onOpen={
              open
                ? () => {
                    close()
                    open()
                  }
                : null
            }
            drag={reached ? linkDragProps(() => linkFromRef(ref)) : {}}
          />
        )
      })}
    </ul>
  )
}

function ContextRow({
  binding,
  label,
  Icon,
  onOpen,
  drag,
}: {
  binding: MessageContextBinding
  label: string
  Icon: ReturnType<typeof refIcon>
  /** Opens the context's target; absent when it has none or never resolved. */
  onOpen: (() => void) | null
  drag: ReturnType<typeof linkDragProps> | Record<string, never>
}) {
  const [expanded, setExpanded] = useState(false)
  const { copied, copy } = useCopied()
  const status = contextStatus(binding.resolution.status)
  const payload = JSON.stringify(binding, null, 2)
  const toggle = () => setExpanded((value) => !value)
  return (
    <li className="min-w-0">
      <div className="group/context-row flex h-(--chrome-control-lg) min-w-0 items-center gap-1 rounded-md pl-2 pr-1 transition-colors hover:bg-surface-hover">
        <button
          type="button"
          // A row with somewhere to go opens it; one without shows its payload instead.
          onClick={onOpen ?? toggle}
          title={onOpen ? `Open ${label}` : undefined}
          {...drag}
          className="flex min-w-0 flex-1 items-center gap-2 self-stretch text-left text-xs outline-none focus-ring"
        >
          <Icon className="size-3.5 shrink-0 text-text-soft" />
          <span className="min-w-0 flex-1 truncate text-foreground">{label}</span>
          <span
            className={cn(
              'shrink-0 text-2xs',
              status.tone === 'attention'
                ? 'text-status-warning'
                : status.tone === 'pending'
                  ? 'text-status-info'
                  : 'text-text-faint',
            )}
          >
            {status.label}
          </span>
        </button>
        <IconButton
          size="xs"
          aria-label={expanded ? `Hide ${label} payload` : `Show ${label} payload`}
          aria-expanded={expanded}
          onClick={toggle}
        >
          <ChevronRight
            className={cn('transition-transform duration-(--dur-fast)', expanded && 'rotate-90')}
          />
        </IconButton>
      </div>
      {expanded && (
        <div className="relative mx-1 mb-1.5 mt-0.5 rounded-md bg-field-fill">
          <IconButton
            size="xs"
            aria-label={copied ? 'Copied' : 'Copy context payload'}
            tooltip={copied ? 'Copied' : 'Copy'}
            onClick={() => void copy(payload)}
            className="absolute right-1 top-1"
          >
            {copied ? <Check /> : <Copy />}
          </IconButton>
          <pre className="scrollbar-thin max-h-60 overflow-auto whitespace-pre-wrap break-all p-2 pr-8 font-mono text-2xs text-text-soft">
            {payload}
          </pre>
        </div>
      )}
    </li>
  )
}
