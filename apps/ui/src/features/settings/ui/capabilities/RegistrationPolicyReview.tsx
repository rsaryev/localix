import type { CapabilityRuleSnapshot } from '@/shared/api/contracts'
import { Button } from '@localixai/kit/button'

/** Proposals are displayed as data until the user adds them to the shared policy editor. */
export function RegistrationPolicyReview({
  registration,
  busy,
  canPublish,
  onAdd,
  onPublish,
}: {
  registration: NonNullable<CapabilityRuleSnapshot['registration']>
  busy: boolean
  canPublish: boolean
  onAdd: () => void
  onPublish: () => void
}) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-text-soft">
        {registration.sourceName} proposes these rules. Review the complete policy below before
        publishing it.
      </p>
      {registration.proposedRules.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr>
                <th>Action</th>
                <th>Resource</th>
                <th>Decision</th>
              </tr>
            </thead>
            <tbody>
              {registration.proposedRules.map((rule, index) => (
                <tr key={index}>
                  <td className="py-1 font-mono">{rule.action}</td>
                  <td className="font-mono">{rule.resource}</td>
                  <td>{rule.effect}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          disabled={busy || !registration.proposedRules.length}
          onClick={onAdd}
        >
          Add proposed rules to draft
        </Button>
        <Button disabled={busy || !canPublish} onClick={onPublish}>
          Publish reviewed policy
        </Button>
      </div>
    </div>
  )
}
