/**
 * The edit buffer for a request tab: a local draft, a dirty flag, and an explicit save.
 *
 * EXPLICIT, not autosave. Requests are shared with the session's agent, which can re-send one
 * mid-turn. Autosaving each keystroke would make a half-typed URL briefly authoritative. A Save
 * button makes the moment of change deliberate; Send also commits the current draft first.
 *
 * `auth` is deliberately absent from the draft. It is not editable here at all — see the schema
 * comment in routes.ts: a browser that could re-point a vaulted credential is a browser that can
 * spend it somewhere else.
 */

import { useCallback, useMemo, useState } from 'react'
import { acknowledgeInline } from '@localixai/mini-app-sdk/ui'
import type { RequestEdit, RequestInfo } from '../../backend/contracts'
import type { Pair, RequestSpec } from '../../backend/request-spec'
import { restApi } from '../restApi'
import { canonicalUrlQuery } from './querySync'
import { editorLanguage, formatJsonBody } from './bodyEditor'

/** Canonicalize valid JSON at the commit boundary; an invalid in-progress body stays untouched. */
export function formatDraftForSave(draft: RequestEdit): RequestEdit {
  const body = draft.body
  if (body?.form || editorLanguage(body?.mimeType) !== 'json') return draft
  if (!body) return draft
  const text = body.text ?? ''
  const formatted = formatJsonBody(text)
  if (formatted === text) return draft
  return { ...draft, body: { ...body, text: formatted } }
}

/** The editable slice of a spec — everything the PUT schema accepts. */
export function draftFrom(spec: RequestSpec): RequestEdit {
  const canonical = canonicalUrlQuery(spec.url, spec.query)
  return formatDraftForSave({
    url: canonical.url,
    method: spec.method,
    headers: [...spec.headers],
    query: canonical.query,
    pathParameters: spec.pathParameters ? [...spec.pathParameters] : [],
    // `form` included: carrying only `text` would send a form body back as `text: undefined`,
    // and a PUT that replaces would then delete it the first time anyone edited the url beside it.
    body: spec.body
      ? { mimeType: spec.body.mimeType, text: spec.body.text, form: spec.body.form }
      : undefined,
    // Per-request send settings MUST be seeded for the same PUT-replaces reason as `form`: a
    // draft that omitted them would silently reset a stored override on the next unrelated save,
    // and the Settings tab would show defaults over what is actually stored.
    followRedirects: spec.followRedirects,
    timeoutMs: spec.timeoutMs,
    maxRedirects: spec.maxRedirects,
  })
}

export function useRequestEdit(
  sessionId: string,
  request: RequestInfo | null,
  onSaved: () => void,
) {
  const [draft, setDraft] = useState<RequestEdit | null>(null)
  const [baseline, setBaseline] = useState<{ name: string; draft: RequestEdit } | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [loaded, setLoaded] = useState<RequestInfo | null>(null)

  // An auth save or an agent update reloads the SAME request. Preserve a locally dirty draft in
  // that case; switching to another request still starts from its server state. Decided while
  // rendering, when the request itself changed, so no frame shows the old draft over the new one.
  if (request !== loaded) {
    setLoaded(request)
    if (!request) {
      setBaseline(null)
      setDraft(null)
    } else {
      const incoming = { name: request.name, draft: draftFrom(request.spec) }
      const locallyDirty =
        baseline?.name === request.name &&
        draft !== null &&
        JSON.stringify(draft) !== JSON.stringify(baseline.draft)
      if (!locallyDirty) setDraft(incoming.draft)
      setBaseline(incoming)
    }
    setError(null)
  }

  const dirty = useMemo(() => {
    if (!request || !draft || baseline?.name !== request.name) return false
    return JSON.stringify(draft) !== JSON.stringify(baseline.draft)
  }, [request, draft, baseline])

  const patch = useCallback((next: Partial<RequestEdit>) => {
    setDraft((d) => (d ? { ...d, ...next } : d))
  }, [])

  // Resolves to whether the save landed, so Send can chain on it (save-then-send) and stop
  // when the server refused the edit — the refusal is already in `error`.
  const save = useCallback(async (): Promise<boolean> => {
    if (!request || !draft) return false
    setSaving(true)
    setError(null)
    try {
      const committed = formatDraftForSave(draft)
      // Reflect formatting immediately; the server response below remains authoritative.
      if (committed !== draft) setDraft(committed)
      const response = await restApi.update(sessionId, request.name, committed)
      const incoming = { name: response.request.name, draft: draftFrom(response.request.spec) }
      setBaseline(incoming)
      setDraft(incoming.draft)
      // Re-read rather than trust the draft: the server is what decides what got stored (it
      // keeps `auth`, and it re-resolves the template against the active environment).
      onSaved()
      return true
    } catch (err) {
      acknowledgeInline(err)
      setError(err instanceof Error ? err.message : 'Could not save the request.')
      return false
    } finally {
      setSaving(false)
    }
  }, [sessionId, request, draft, onSaved])

  const reset = useCallback(() => {
    if (baseline && request && baseline.name === request.name) setDraft(baseline.draft)
    else setDraft(request ? draftFrom(request.spec) : null)
    setError(null)
  }, [request, baseline])

  const setPairs = useCallback(
    (field: 'headers' | 'query' | 'pathParameters', pairs: Pair[]) => patch({ [field]: pairs }),
    [patch],
  )

  return { draft, dirty, saving, error, patch, setPairs, save, reset }
}
