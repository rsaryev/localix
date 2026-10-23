import { CheckCircle2 } from 'lucide-react'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import type { EffectiveConfigReport } from '@localixai/api/client'
import { DIVIDED_LIST } from '@localixai/kit/divided-list'
import { DiagnosticIcon, FACT_GROUP_LABEL, InlineFacts } from './DiagnosticsFacts'
import { SettingsSection } from './SettingsScaffold'

/**
 * The resolved configuration, section by section — what `DiagnosticsSettings` shows once a scope
 * has been resolved. Split from the page so the page answers "which scope, and is it loading" and
 * this file answers "what does the runtime apply there", each readable without the other.
 */
export function DiagnosticsReport({ report }: { report: EffectiveConfigReport }) {
  return (
    <>
      <ValidationSection report={report} />
      <ConsumersSection report={report} />
      <ToolsSection report={report} />
      <PermissionsSection report={report} />
      <ValuesSection report={report} />
      <ExtensionsSection report={report} />
    </>
  )
}

function ValidationSection({ report }: { report: EffectiveConfigReport }) {
  return (
    <SettingsSection
      title="Validation"
      anchor="diagnostics-validation"
      description="Cross-field checks over the resolved configuration."
    >
      {report.diagnostics.length === 0 ? (
        <div className="flex items-center gap-2 border-y border-border-faint py-3 text-sm text-text-soft">
          <CheckCircle2 className="size-4 text-status-success" /> No configuration problems
          detected.
        </div>
      ) : (
        <ul className={DIVIDED_LIST}>
          {report.diagnostics.map((d) => (
            <li
              key={`${d.code}:${d.field ?? ''}:${d.message}`}
              className="flex items-start gap-2 py-2.5 text-sm"
            >
              <DiagnosticIcon severity={d.severity} />
              <div className="min-w-0">
                <div className="text-foreground">{d.message}</div>
                <InlineFacts
                  className="mt-0.5"
                  items={[
                    { key: 'severity', label: d.severity, tone: d.severity },
                    { key: 'code', label: <code>{d.code}</code> },
                    ...(d.field ? [{ key: 'field', label: d.field }] : []),
                  ]}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </SettingsSection>
  )
}

function ConsumersSection({ report }: { report: EffectiveConfigReport }) {
  return (
    <SettingsSection
      title="Resolved model per consumer"
      anchor="diagnostics-models"
      description="Which provider model each surface will actually use, and via which path."
    >
      <ul className={DIVIDED_LIST}>
        {report.consumers.map((c) => (
          <li key={c.id} className="flex items-center gap-3 px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm text-foreground">{c.label}</div>
              <div className="truncate text-xs text-text-soft">
                {c.modelId ? (
                  <span className="font-mono">{c.modelId}</span>
                ) : (
                  <span className="italic">no model</span>
                )}
                {c.reason && <span> · {c.reason}</span>}
              </div>
            </div>
            <InlineFacts
              className="shrink-0"
              items={[
                { key: 'source', label: c.source },
                {
                  key: 'usable',
                  label: c.usable ? 'usable' : 'unusable',
                  tone: c.usable ? 'success' : 'error',
                  dotClass: c.usable ? 'bg-status-success' : 'bg-status-error',
                },
              ]}
            />
          </li>
        ))}
      </ul>
    </SettingsSection>
  )
}

function ToolsSection({ report }: { report: EffectiveConfigReport }) {
  const { tools } = report
  return (
    <SettingsSection
      title="Tool policy"
      anchor="diagnostics-tools"
      description="Server catalog after the scope’s own rules. Per-run host availability is applied later."
    >
      <div className="space-y-3">
        <div>
          <div className={FACT_GROUP_LABEL}>Enabled ({tools.enabled.length})</div>
          <InlineFacts
            className="font-mono"
            items={tools.enabled.map((tool) => ({
              key: tool,
              label: tool,
              tone: 'success',
            }))}
          />
        </div>
        {tools.disabled.length > 0 && (
          <div>
            <div className={FACT_GROUP_LABEL}>Disabled ({tools.disabled.length})</div>
            <InlineFacts
              className="font-mono"
              items={tools.disabled.map((tool) => ({
                key: tool.name,
                label: tool.name,
                title: tool.reason,
              }))}
            />
          </div>
        )}
      </div>
    </SettingsSection>
  )
}

function PermissionsSection({ report }: { report: EffectiveConfigReport }) {
  return (
    <SettingsSection
      title="Permissions"
      anchor="diagnostics-permissions"
      description="Effective permission rules, evaluated in order (last match wins)."
    >
      {report.permissions.length === 0 ? (
        <p className="text-sm text-text-soft">No custom rules — the baseline applies.</p>
      ) : (
        <ul className={cn(DIVIDED_LIST, 'text-sm')}>
          {report.permissions.map((r) => (
            <li
              key={`${r.scope}:${r.permission}:${r.pattern}:${r.action}`}
              className="flex items-center gap-2 px-3 py-2"
            >
              <InlineFacts
                className="min-w-0 flex-1"
                items={[
                  {
                    key: 'action',
                    label: r.action,
                    tone:
                      r.action === 'deny' ? 'error' : r.action === 'ask' ? 'warning' : 'success',
                    dotClass:
                      r.action === 'deny'
                        ? 'bg-status-error'
                        : r.action === 'ask'
                          ? 'bg-status-warning'
                          : 'bg-status-success',
                  },
                  {
                    key: 'permission',
                    label: <code className="text-foreground">{r.permission}</code>,
                  },
                  { key: 'pattern', label: r.pattern },
                ]}
              />
              <code className="ml-auto shrink-0 text-2xs text-text-soft">{r.scope}</code>
            </li>
          ))}
        </ul>
      )}
    </SettingsSection>
  )
}

function ValuesSection({ report }: { report: EffectiveConfigReport }) {
  const keys = Object.keys(report.provenance).sort()
  return (
    <SettingsSection
      title="Resolved values"
      anchor="diagnostics-values"
      description="Every setting, its source, and when a change takes effect."
    >
      <ul className={cn(DIVIDED_LIST, 'text-sm')}>
        {keys.map((k) => {
          const prov = report.provenance[k]
          return (
            <li key={k} className="flex items-center gap-2 px-3 py-2">
              <code className="text-foreground">{k}</code>
              <InlineFacts
                className="ml-auto justify-end font-mono"
                items={[
                  {
                    key: 'scope',
                    label: prov.sourceId ? `${prov.scope} · ${prov.sourceId}` : prov.scope,
                    title: prov.sourceId ? `from ${prov.sourceId}` : undefined,
                  },
                  { key: 'reload', label: report.reload[k] },
                ]}
              />
            </li>
          )
        })}
      </ul>
    </SettingsSection>
  )
}

function ExtensionsSection({ report }: { report: EffectiveConfigReport }) {
  return (
    <SettingsSection
      title="Skills & plugins"
      anchor="diagnostics-extensions"
      description="Skill visibility overrides and the plugins in scope."
    >
      <div className="space-y-3">
        {report.skills.length > 0 && (
          <div>
            <div className={FACT_GROUP_LABEL}>Skill overrides</div>
            <InlineFacts
              className="font-mono"
              items={report.skills.map((skill) => ({
                key: skill.name,
                label: `${skill.name}: ${skill.override}`,
              }))}
            />
          </div>
        )}
        <div>
          <div className={FACT_GROUP_LABEL}>Mini apps ({report.miniApps.length})</div>
          {report.miniApps.length === 0 ? (
            <p className="text-sm text-text-soft">None in scope.</p>
          ) : (
            <InlineFacts
              className="font-mono"
              items={report.miniApps.map((app) => ({
                key: app.name,
                label: app.name,
                tone: app.enabled ? 'success' : 'neutral',
                dotClass: app.enabled ? 'bg-status-success' : 'bg-text-faint opacity-50',
              }))}
            />
          )}
        </div>
      </div>
    </SettingsSection>
  )
}
