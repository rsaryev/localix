import { Input } from '@localixai/kit/input'
import { Switch } from '@localixai/kit/switch'
import type { RequestEdit as RequestDraft } from '../../backend/contracts'
import { FormRow } from './FormRow'

/** The request's transport settings: redirects and timeout, blank meaning the mini app default. */
export function RequestSettings({
  draft,
  patch,
}: {
  draft: RequestDraft
  patch: (next: Partial<RequestDraft>) => void
}) {
  // The whole `followRedirects` fallback is `true` — the mini app default when the request sets
  // none.
  const followRedirects = draft.followRedirects ?? true
  return (
    <div>
      <div className="border-b border-border-soft">
        <FormRow label="Follow redirects" hint="Follow 3xx responses to their target.">
          <Switch
            aria-label="Follow redirects"
            checked={followRedirects}
            onChange={() => patch({ followRedirects: !followRedirects })}
          />
        </FormRow>
        <FormRow label="Timeout">
          <span className="flex items-center gap-2">
            <Input
              type="number"
              min={1}
              size="md"
              className="w-40 font-mono text-xs"
              value={draft.timeoutMs ?? ''}
              placeholder="Default"
              onChange={(e) =>
                patch({
                  timeoutMs: e.target.value === '' ? undefined : Number(e.target.value),
                })
              }
            />
            <span className="shrink-0 text-2xs text-text-faint">ms</span>
          </span>
        </FormRow>
        <FormRow label="Max redirects">
          <Input
            type="number"
            min={1}
            size="md"
            className="w-40 font-mono text-xs"
            value={draft.maxRedirects ?? ''}
            placeholder="Default"
            onChange={(e) =>
              patch({
                maxRedirects: e.target.value === '' ? undefined : Number(e.target.value),
              })
            }
          />
        </FormRow>
      </div>
      <p className="px-3 py-2 text-2xs text-text-faint">
        Leave a field blank to use the mini app default. Saved with the request.
      </p>
    </div>
  )
}
