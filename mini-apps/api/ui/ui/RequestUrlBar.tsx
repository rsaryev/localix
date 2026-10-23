import { Save, Send, Square } from 'lucide-react'
import { IconButton } from '@localixai/kit/icon-button'
import { Input } from '@localixai/kit/input'
import { Select } from '@localixai/kit/select'
import { cn, FIELD_SURFACE } from '@localixai/mini-app-sdk/ui/classes'
import type { RequestEdit } from '../../backend/contracts'
import { HTTP_METHODS, type HttpMethod } from '../../backend/request-spec'
import { methodTone } from '../model/presentation'
import { queryDraftFromUrl, urlWithQuery } from '../model/querySync'
import { syncPathParameters } from '../model/pathSync'

/** Static map — a template-built `text-status-…` class would never reach the Tailwind build. */
const TONE_TEXT: Record<string, string> = {
  success: 'text-status-success',
  warning: 'text-status-warning',
  error: 'text-status-error',
  info: 'text-status-info',
}

/** Method · url · Save · Send — one field surface inside the request toolbar. */
export function RequestUrlBar({
  draft,
  patch,
  dirty,
  saving,
  sending,
  agentSending,
  onSave,
  onSend,
  onCancelSend,
}: {
  draft: RequestEdit
  patch: (next: Partial<RequestEdit>) => void
  dirty: boolean
  saving: boolean
  sending: boolean
  agentSending: boolean
  onSave: () => void
  onSend: () => void
  onCancelSend: () => void
}) {
  const requestBusy = sending || agentSending
  const displayUrl = urlWithQuery(draft.url, draft.query)
  return (
    <div
      className={cn(
        FIELD_SURFACE,
        'flex min-w-0 flex-1 items-center overflow-hidden transition-colors duration-(--dur-fast) focus-within:border-control-border-hover',
      )}
    >
      <Select
        aria-label="Method"
        size="lg"
        className={cn(
          'w-20 shrink-0 rounded-none border-0 border-r border-border-soft bg-transparent font-mono font-semibold shadow-none focus-ring',
          TONE_TEXT[methodTone(draft.method as HttpMethod)],
        )}
        value={draft.method}
        options={HTTP_METHODS.map((m) => ({ value: m, label: m }))}
        onValueChange={(method) => patch({ method })}
      />
      <Input
        size="lg"
        className="min-w-0 flex-1 rounded-none border-0 bg-transparent font-mono text-xs shadow-none focus-ring"
        value={displayUrl}
        placeholder="https://api.example.dev/things or {{base_url}}/things"
        onChange={(e) => {
          const next = queryDraftFromUrl(e.target.value, draft.query)
          patch({
            ...next,
            pathParameters: syncPathParameters(next.url, draft.pathParameters),
          })
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            onSend()
          }
        }}
        aria-label="URL"
        spellCheck={false}
      />
      <IconButton
        size="lg"
        className={cn(
          'shrink-0 rounded-none border-l border-border-soft',
          dirty && 'text-status-warning',
        )}
        aria-label={saving ? 'Saving request' : 'Save request'}
        tooltip={dirty ? 'Save request (Ctrl/Cmd+S)' : 'Request is saved'}
        onClick={onSave}
        disabled={!dirty || saving || requestBusy}
      >
        <Save className={cn('size-3.5', saving && 'animate-pulse')} />
      </IconButton>
      <IconButton
        size="lg"
        className={cn(
          'shrink-0 rounded-none border-l border-border-soft',
          !requestBusy && 'text-status-info',
        )}
        aria-label={sending ? 'Cancel request' : agentSending ? 'Agent is sending request' : 'Send'}
        tooltip={
          sending ? 'Cancel request' : agentSending ? 'Agent is sending this request' : 'Send (⌘↵)'
        }
        onClick={sending ? onCancelSend : onSend}
        disabled={saving || agentSending}
      >
        {sending ? (
          <Square className="size-3.5 fill-current" />
        ) : (
          <Send className={cn('size-3.5', agentSending && 'animate-pulse')} />
        )}
      </IconButton>
    </div>
  )
}
