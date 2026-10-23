import { EmptyHint } from '@localixai/kit/empty-hint'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import type { EnvVariable, RequestEdit as RequestDraft } from '../../backend/contracts'
import { BodyEditor } from './BodyEditor'
import { PairEditor } from './PairEditor'

/** The Body tab: form rows, a text body, or why there is none. */
export function RequestBodyPane({
  draft,
  canSendBody,
  variables,
  patch,
  onSave,
  onSubmit,
}: {
  draft: RequestDraft
  canSendBody: boolean
  variables: ReadonlyArray<EnvVariable>
  patch: (next: Partial<RequestDraft>) => void
  onSave: () => void
  onSubmit: () => void
}) {
  return (
    <div
      className={cn(
        'flex h-full min-h-0 flex-col',
        draft.body?.form ? 'scrollbar-thin overflow-auto' : 'overflow-hidden',
      )}
    >
      {!canSendBody ? (
        <div className="px-3 py-2 text-2xs text-text-faint">
          {draft.method} does not send a body.
          {draft.body ? ' The configured body is preserved for another method.' : ''}
        </div>
      ) : draft.body ? (
        draft.body.form ? (
          <PairEditor
            label="Form fields"
            pairs={draft.body.form}
            onChange={(form) => patch({ body: { ...draft.body, form } })}
            variables={variables}
          />
        ) : (
          <BodyEditor
            value={draft.body.text ?? ''}
            mimeType={draft.body.mimeType}
            variables={variables}
            onChange={(text) => patch({ body: { ...draft.body, text } })}
            onSave={onSave}
            onSubmit={onSubmit}
          />
        )
      ) : (
        <EmptyHint className="flex-1">
          This request sends no body. Pick a type above to add one.
        </EmptyHint>
      )}
    </div>
  )
}
