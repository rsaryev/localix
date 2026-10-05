import { useMemo, useState } from 'react'
import { useWorkItemVisible } from '@localixai/plugin-sdk/ui/visibility'
import { scopeAgentId } from '@/shared/api/capabilityScope'
import { ActivitySignal } from '@localixai/kit/activity-orb'
import { Button } from '@localixai/kit/button'
import { ConfirmDialog } from '@localixai/kit/confirm-dialog'
import { useCapabilitySnapshot } from '@/shared/contrib/useCapabilitySnapshot'
import { usePermissionRules } from '../../model/usePermissionRules'
import { PermissionEditor, PermissionLegend } from '../PermissionEditor'
import { SettingsSection, SettingsSurface } from '../SettingsScaffold'
import { RegistrationPolicyReview } from './RegistrationPolicyReview'
import { useScopeActionVocabulary } from './scopeActionVocabulary'

/**
 * The permission rules for ONE scope — every kind, in one ordered list.
 *
 * This is the general form of the four registry tabs. A switch there writes one row here:
 * `skill:deploy` over `*` with effect `deny` is what hiding a skill stores, and the same is
 * true of a tool, a plugin, an MCP server and one of its tools. What only this screen can
 * say is the rest of the grammar — an argument pattern (`tool:bash` over `git push*`), the
 * middle effect `ask`, a family (`mcp:github/*`), and the ORDER, which decides which of two
 * overlapping rules wins.
 *
 * It is its own tab rather than a section under Tools because it is not about tools: it was
 * sitting under one kind while governing five, so four of them had rules nobody could see.
 *
 * Remount it with a `key` on the scope so no edit crosses from one scope to the next.
 */
export function PermissionRulesView({ scope }: { scope: string }) {
  const visible = useWorkItemVisible()
  const rules = usePermissionRules(scope, visible)
  const { snapshot } = useCapabilitySnapshot(scope, visible)
  const vocabulary = useScopeActionVocabulary(snapshot)
  const agentScope = scopeAgentId(scope)
  const [confirmReset, setConfirmReset] = useState(false)

  const applyLabel = rules.registration ? 'Publish' : 'Apply'
  const canApply = rules.dirty && !rules.saving && !rules.loadError
  const shipped = useMemo(() => rules.defaults, [rules.defaults])

  const reset = () => {
    // Staging rather than writing is the confirmation: nothing lands until Apply, so the
    // shipped list can be read on screen before it replaces anything. The dialog is only for
    // the case where staging would silently throw away edits the user has not applied yet.
    if (rules.dirty) setConfirmReset(true)
    else rules.stageDefaults()
  }

  return (
    <div className="space-y-8">
      <SettingsSection
        title="Permission rules"
        description={
          <>
            One ordered list for every kind — tools, skills, MCP servers and their tools, plugins
            and agents. <span className="text-text-soft">Last match wins.</span>
            {!agentScope && (
              <>
                {' '}
                <span className="text-text-soft">
                  Rules belong to an agent; pick one above to edit its own list. These are the
                  default assistant&apos;s.
                </span>
              </>
            )}
          </>
        }
        actions={
          // Present only when there is something to apply. A permanently visible, permanently
          // greyed button is a control that reads as broken: it says the screen offers an
          // action and then refuses it, on a screen whose whole job is to be unambiguous
          // about what is in force. Nothing to apply, nothing to press.
          rules.dirty || rules.resettable ? (
            <div className="flex flex-wrap items-center gap-2">
              {rules.resettable && (
                <Button size="xl" variant="ghost" disabled={rules.saving} onClick={reset}>
                  Reset to defaults
                </Button>
              )}
              {rules.dirty && (
                <Button size="xl" disabled={!canApply} onClick={() => void rules.apply()}>
                  {applyLabel}
                </Button>
              )}
            </div>
          ) : undefined
        }
      >
        {rules.registration && (
          <RegistrationPolicyReview
            registration={rules.registration}
            busy={rules.saving}
            canPublish={!rules.loadError}
            onAdd={() => rules.edit([...rules.rules, ...rules.registration!.proposedRules])}
            onPublish={() => void rules.apply()}
          />
        )}
        {/* Nothing between the heading and the rules: the apply control rides the heading
            (see `actions` above), so an edit is never one scroll away from what commits it. */}
        <SettingsSurface>
          <PermissionEditor
            rules={rules.rules}
            actionNames={vocabulary.actions}
            agentIds={vocabulary.agentIds}
            invocationHosts={vocabulary.invocationHosts}
            grammar={vocabulary.grammar}
            {...(agentScope ? { scopeAgentId: agentScope } : {})}
            shipped={shipped}
            onChange={rules.edit}
          />
        </SettingsSurface>
        <PermissionLegend grammar={vocabulary.grammar} />
        {rules.dirty && !rules.saving && (
          <p role="status" className="text-xs text-status-warning">
            Not applied yet — {applyLabel} to put these rules in force.
          </p>
        )}
        {rules.published && (
          <p role="status" className="text-xs text-text-soft">
            Reviewed policy published.
          </p>
        )}
        {rules.saving && (
          <ActivitySignal
            label={rules.registration ? 'Publishing permission rules' : 'Saving permission rules'}
            className="text-xs text-text-soft"
            labelClassName="min-w-0"
          />
        )}
      </SettingsSection>

      {(rules.saveError ?? rules.loadError) && (
        <div className="space-y-2">
          <p role="alert" className="text-xs text-status-error">
            {rules.saveError ?? rules.loadError}
          </p>
          <Button size="xl" variant="ghost" disabled={rules.saving} onClick={rules.discard}>
            Reload saved rules
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={confirmReset}
        title="Discard your edits?"
        description="Resetting stages the rules this role ships with, replacing the changes you have not applied yet. Nothing is written until you press Apply."
        confirmLabel="Stage the shipped rules"
        onConfirm={() => {
          rules.stageDefaults()
          setConfirmReset(false)
        }}
        onClose={() => setConfirmReset(false)}
      />
    </div>
  )
}
