import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { inlineFailure } from '@/shared/lib/notifications/inlineReport'
import { RefreshCw } from 'lucide-react'
import { ActivitySignal } from '@localixai/kit/activity-orb'
import { Button } from '@localixai/kit/button'
import { Input } from '@localixai/kit/input'
import { SectionHeading } from '@localixai/kit/section-heading'
import { Select } from '@localixai/kit/select'
import { effectiveConfigApi } from '@/shared/api/effectiveConfigApi'
import { useWorkItemVisible } from '@localixai/mini-app-sdk/ui/visibility'
import type { EffectiveConfigReport } from '@localixai/api/client'
import { useSettingsProjects } from '../model/useSettingsProjects'
import { DiagnosticsReport } from './DiagnosticsReport'
import { SettingProblems } from './settingRegistry'
import { SettingsActionActivity } from './SettingsActionActivity'

/**
 * READ-ONLY "Effective agent configuration" diagnostics. Shows the settings the
 * runtime actually resolves for a scope (user → project → session) — the
 * resolved model per consumer, the source of each
 * value, the effective tool policy, permission summary, reload requirement, and
 * cross-field validation warnings. It never mutates settings and the endpoint
 * never returns a secret, connection credential, or the raw system prompt.
 *
 * This file owns the scope and the request; `DiagnosticsReport` renders what came back.
 */
export function DiagnosticsSettings({ embedded = false }: { embedded?: boolean } = {}) {
  const workItemVisible = useWorkItemVisible()
  const projectLabelId = useId()
  const sessionLabelId = useId()
  const projects = useSettingsProjects()
  const [projectId, setProjectId] = useState('')
  const [sessionId, setSessionId] = useState('')
  const [report, setReport] = useState<EffectiveConfigReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Guards a stale in-flight resolve from overwriting a newer one: the scope inputs
  // (esp. the free-text session id) re-fire this per keystroke, so a slow earlier
  // request could land after a faster later one and paint the wrong scope's report.
  // The same bump invalidates a request whose panel unmounted before it settled.
  const reqId = useRef(0)
  const refresh = useCallback(async () => {
    const id = ++reqId.current
    setLoading(true)
    setError(null)
    try {
      const next = await effectiveConfigApi.get({
        projectId: projectId || undefined,
        sessionId: sessionId.trim() || undefined,
      })
      if (id === reqId.current) setReport(next)
    } catch (e) {
      if (id === reqId.current)
        setError(inlineFailure(e, 'The effective configuration could not be resolved.'))
    } finally {
      if (id === reqId.current) setLoading(false)
    }
  }, [projectId, sessionId])

  useEffect(() => {
    if (!workItemVisible) return
    // Capture the ref OBJECT (not its value): `useRef` hands back the same object for the
    // component's whole life, so bumping `seq.current` at cleanup still bumps the live
    // counter — which is the point. Reading `reqId.current` inside the cleanup body instead
    // is the shape that trips the stale-capture warning, and it buys nothing here.
    const seq = reqId
    void refresh()
    // Invalidate an in-flight resolve when the scope changes OR the panel unmounts, so its
    // late response cannot paint over a newer one — or over a panel that is already gone.
    return () => {
      seq.current++
    }
  }, [refresh, workItemVisible])

  return (
    <div className="space-y-8 text-left">
      {!embedded && (
        <SectionHeading
          title="Diagnostics"
          description="Inspect the configuration applied to a project or session. This report is read-only and hides secret values."
        />
      )}
      {/* Scope controls */}
      <div
        role="group"
        aria-label="Effective configuration scope"
        className="flex flex-wrap items-end gap-3 border-y border-border-faint py-3"
      >
        <div className="flex flex-col gap-1 text-xs text-text-soft">
          <span id={projectLabelId}>Project</span>
          <Select
            aria-labelledby={projectLabelId}
            size="xl"
            className="min-w-40"
            value={projectId}
            onValueChange={setProjectId}
            options={[
              { value: '', label: 'No project' },
              ...projects.map((project) => ({
                value: project.id,
                label: project.name,
              })),
            ]}
          />
        </div>
        <label htmlFor={sessionLabelId} className="flex flex-col gap-1 text-xs text-text-soft">
          Session id
          <Input
            id={sessionLabelId}
            size="xl"
            className="min-w-36"
            placeholder="e.g. LOCALIX-12"
            value={sessionId}
            spellCheck={false}
            onChange={(e) => setSessionId(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void refresh()
            }}
          />
        </label>
        <Button
          variant="outline"
          size="xl"
          aria-busy={loading}
          onClick={() => {
            void refresh()
          }}
        >
          {loading ? (
            <SettingsActionActivity label="Resolving" />
          ) : (
            <>
              <RefreshCw aria-hidden="true" /> Refresh
            </>
          )}
        </Button>
        {report && (
          <span
            className="ml-auto self-center font-mono text-2xs text-text-soft"
            title="Revision (content hash of resolved values)"
          >
            rev {report.revision}
          </span>
        )}
      </div>

      <SettingProblems
        subject="Effective configuration"
        errors={error ? [error] : []}
        onRetry={() => void refresh()}
      />

      {loading && !report ? (
        <div className="py-6 text-sm text-text-soft">
          <ActivitySignal label="Resolving effective configuration" />
        </div>
      ) : report ? (
        <DiagnosticsReport report={report} />
      ) : null}
    </div>
  )
}
