/**
 * The Auth tab — an EDITABLE form, not the read-only display it used to be.
 *
 * It saves through `PUT /requests/:name/auth`, which merges with the keep-the-mask rule: a secret
 * the user never touched stays `••••••` on the wire and the server keeps the stored value, so the
 * browser edits auth without ever seeing — or being able to leak — the real credential.
 *
 * A secret-bearing field is a {@link SecretField}: it can POINT at the vault, chosen from the
 * vault's own list, instead of holding a value. Typing a literal still works and is moved into
 * the vault on save — the collection is a directory in the repo and refuses to store one — but
 * that mints a NEW key each time, so the same token lands three times under three names and
 * rotating it fixes one request. Picking the existing key is the path that stays correct.
 *
 * Auth is per-request and explicit-save, like the rest of the tab — no autosave of a half-typed
 * token onto a request an agent might re-send mid-turn.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { KeyRound, Save } from 'lucide-react'
import { acknowledgeInline } from '@localixai/mini-app-sdk/ui'
import { Button } from '@localixai/kit/button'
import { Input } from '@localixai/kit/input'
import { Select } from '@localixai/kit/select'
import { AUTH_TYPES, type RequestAuth } from '../../backend/request-spec'
import { restApi, RestApiError } from '../restApi'
import { FormRow as Field } from './FormRow'
import { SecretField, secretFieldHint } from './SecretField'

const TYPE_LABELS: Record<RequestAuth['type'], string> = {
  none: 'No auth',
  basic: 'Basic',
  bearer: 'Bearer token',
  apikey: 'API key',
}

/** A fresh block of a given type, so switching type never carries a stale field. */
function blankOf(type: RequestAuth['type']): RequestAuth {
  switch (type) {
    case 'basic':
      return { type: 'basic', username: '', password: '' }
    case 'bearer':
      return { type: 'bearer', token: '' }
    case 'apikey':
      return { type: 'apikey', key: '', value: '', addTo: 'header' }
    case 'none':
      return { type: 'none' }
  }
}

export function AuthEditor({
  sessionId,
  name,
  auth: stored,
  onSaved,
}: {
  /** The chat whose project holds the request — its tab's session. */
  sessionId: string
  name: string
  /** The REDACTED stored auth — a literal secret arrives as `••••••`, a reference reads through. */
  auth: RequestAuth
  onSaved: () => void
}) {
  const [draft, setDraft] = useState<RequestAuth>(stored)
  const [baseline, setBaseline] = useState(stored)
  const baselineRef = useRef<{ name: string; auth: RequestAuth }>({ name, auth: stored })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reloading the same request after a non-auth save must not erase a half-edited token. A clean
  // editor, however, follows agent/server auth changes immediately.
  useEffect(() => {
    const previous = baselineRef.current
    setDraft((current) => {
      const locallyDirty =
        previous.name === name && JSON.stringify(current) !== JSON.stringify(previous.auth)
      return locallyDirty ? current : stored
    })
    baselineRef.current = { name, auth: stored }
    setBaseline(stored)
  }, [name, stored])

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(baseline), [draft, baseline])

  const save = () => {
    if (saving) return
    setSaving(true)
    setError(null)
    void restApi
      .setAuth(sessionId, name, draft)
      .then((response) => {
        // A typed literal comes back only as its vault reference/mask. Replace the browser draft
        // immediately so the literal is not retained in component memory after it is vaulted.
        const saved = response.request.spec.auth
        baselineRef.current = { name, auth: saved }
        setBaseline(saved)
        setDraft(saved)
        onSaved()
      })
      .catch((err: unknown) => {
        acknowledgeInline(err)
        setError(err instanceof RestApiError ? err.message : 'Could not save auth.')
      })
      .finally(() => setSaving(false))
  }

  // A patch helper that stays within the current type's shape.
  const patch = (next: Partial<RequestAuth>) => setDraft((d) => ({ ...d, ...next }) as RequestAuth)

  // The secret-bearing field of whatever type is selected — the one the hint line speaks about.
  const secretValue =
    draft.type === 'basic'
      ? draft.password
      : draft.type === 'bearer'
        ? draft.token
        : draft.type === 'apikey'
          ? draft.value
          : ''
  const secretHint = secretFieldHint(secretValue)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
        <div className="border-b border-border-soft">
          <Field label="Auth type">
            <Select
              aria-label="Auth type"
              size="md"
              className="w-52"
              value={draft.type}
              options={AUTH_TYPES.map((t) => ({ value: t, label: TYPE_LABELS[t] }))}
              onValueChange={(t) => setDraft(blankOf(t as RequestAuth['type']))}
            />
          </Field>

          {draft.type === 'basic' && (
            <>
              <Field label="Username">
                <Input
                  className="font-mono text-xs"
                  value={draft.username}
                  onChange={(e) => patch({ username: e.target.value })}
                  placeholder="user"
                />
              </Field>
              <Field label="Password">
                <SecretField
                  ariaLabel="Password"
                  value={draft.password}
                  onChange={(password) => patch({ password })}
                  placeholder="•••••• or select a Vault key"
                />
              </Field>
            </>
          )}

          {draft.type === 'bearer' && (
            <>
              <Field label="Token">
                <SecretField
                  ariaLabel="Token"
                  value={draft.token}
                  onChange={(token) => patch({ token })}
                  placeholder="•••••• or select a Vault key"
                />
              </Field>
              <Field label="Prefix">
                <Input
                  className="font-mono text-xs"
                  value={draft.prefix ?? ''}
                  onChange={(e) => patch({ prefix: e.target.value || undefined })}
                  placeholder="Bearer"
                />
              </Field>
            </>
          )}

          {draft.type === 'apikey' && (
            <>
              <Field label="Key">
                <Input
                  className="font-mono text-xs"
                  value={draft.key}
                  onChange={(e) => patch({ key: e.target.value })}
                  placeholder="X-Api-Key"
                />
              </Field>
              <Field label="Value">
                <SecretField
                  ariaLabel="API key value"
                  value={draft.value}
                  onChange={(value) => patch({ value })}
                  placeholder="•••••• or select a Vault key"
                />
              </Field>
              <Field label="Send in">
                <Select
                  aria-label="Add API key to"
                  size="md"
                  className="w-44"
                  value={draft.addTo ?? 'header'}
                  options={[
                    { value: 'header', label: 'Header' },
                    { value: 'query', label: 'Query parameter' },
                    { value: 'cookie', label: 'Cookie' },
                  ]}
                  onValueChange={(v) => patch({ addTo: v as 'header' | 'query' | 'cookie' })}
                />
              </Field>
            </>
          )}
        </div>

        {draft.type === 'none' ? (
          <p className="px-3 py-2 text-2xs text-text-faint">
            This request does not add an Authorization header or API key.
          </p>
        ) : (
          <div className="flex items-start gap-2 px-3 py-2 text-2xs text-text-faint">
            <KeyRound className="mt-px size-3.5 shrink-0 text-status-info" />
            <span>
              {secretHint ??
                'Select an existing Vault key, or type a value. Typed credentials move into native Vault on save and never enter the request file.'}
            </span>
          </div>
        )}

        {error && (
          <p role="alert" className="px-3 py-2 text-2xs text-status-error">
            {error}
          </p>
        )}
      </div>

      <div className="flex h-10 shrink-0 items-center justify-end border-t border-border-soft px-3">
        <Button size="sm" variant="mono" onClick={save} disabled={!dirty || saving}>
          <Save className="size-3.5" />
          {saving ? 'Saving…' : 'Save auth'}
        </Button>
      </div>
    </div>
  )
}
