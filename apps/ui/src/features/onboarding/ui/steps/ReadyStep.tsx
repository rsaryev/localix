import { useEffect } from 'react'
import { ArrowRight, Check, Plug, TriangleAlert } from 'lucide-react'
import { cn } from '@localixai/plugin-sdk/ui/classes'
import { useChatStore } from '@/features/chat/model/store'
import { startupHalvesOf, startupProject } from '../../model/startupModel'
import { StepHeader } from '../StepHeader'
import { StepActions } from '../wizard/StepActions'
import { ReadySummary, type ReadySummaryRow } from './ReadySummary'
import type { OnboardingStepProps } from '../../model/types'

/**
 * Activation summary — the terminal step, and the reason onboarding can no
 * longer end in a silent dead end. It reads back the pair the Provider step
 * stored ON THE PROJECT (`model/startupModel.ts`) — the same field every new
 * chat's model chain consults — resolves the connection against the live list,
 * and states the activation state plainly, alongside the other choices the
 * wizard made.
 *
 * If nothing resolves (Provider skipped, or the connection was since removed)
 * it says so and offers a one-click jump BACK to the Provider step — you can
 * still finish, but never while unaware there's no working model.
 */
export function ReadyStep({ onComplete, onJumpTo }: OnboardingStepProps) {
  const connections = useChatStore((s) => s.connections)
  const refreshConnections = useChatStore((s) => s.refreshConnections)

  const loadProjects = useChatStore((s) => s.loadProjects)
  const projectCount = useChatStore((s) => s.projects.length)
  // The stored pair lives on the project, so an OAuth reload that lands here cold has to fetch
  // the projects as well as the connections before this step can state anything.
  useEffect(() => {
    if (projectCount === 0) void loadProjects()
  }, [projectCount, loadProjects])

  // Reaching the last step after an OAuth reload can leave the store cold.
  useEffect(() => {
    void refreshConnections()
  }, [refreshConnections])

  // What the workspace will actually start on, read back from the project the previous step
  // wrote it to — not from a browser copy that could disagree with it.
  //
  // The HALVES, not the resolved pair: this step exists to tell "nothing is wired" apart from
  // "a provider is connected but no model is picked", and a both-or-nothing read cannot say the
  // second one.
  const projects = useChatStore((s) => s.projects)
  const { providerConnectionId, modelId } = startupHalvesOf(startupProject(projects))
  const connection = providerConnectionId
    ? (connections.find((c) => c.id === providerConnectionId) ?? null)
    : null
  // BOTH halves are required: a model without a live connection can't run, and a
  // connection without a chosen model leaves the first chat unwired.
  const ready = Boolean(connection && modelId)

  const rows: ReadySummaryRow[] = ready
    ? ([
        {
          label: 'Provider',
          value:
            connection && connection.label !== connection.providerName
              ? `${connection.providerName} · ${connection.label}`
              : (connection?.providerName ?? ''),
          changeStepId: 'provider',
        },
        {
          label: 'Default model',
          value: modelId ?? '',
          mono: true,
          changeStepId: 'provider',
        },
      ] satisfies ReadySummaryRow[])
    : []

  return (
    <div className="flex flex-col items-center gap-6 text-center">
      <StepHeader
        title={ready ? "You're all set" : 'One thing missing'}
        subtitle={
          ready
            ? 'Your first chat opens already wired to this model. Change any route later from the model drawer.'
            : "Setup is done, but no provider and model are wired up — the agent can't run a single message yet."
        }
      />

      <div
        className={cn(
          'w-full space-y-3 border-y py-4 text-left',
          ready ? 'border-border-faint' : 'border-status-warning/20',
        )}
      >
        <div className="flex items-center gap-2">
          {ready ? (
            <Check className="size-4 shrink-0 text-status-success" aria-hidden />
          ) : (
            <TriangleAlert className="size-4 shrink-0 text-status-warning" aria-hidden />
          )}
          <span className="text-sm font-medium text-foreground">
            {ready ? 'Ready to chat' : 'No model connected'}
          </span>
        </div>

        {!ready && (
          <p className="text-xs leading-relaxed text-text-soft">
            {connection && !modelId
              ? `${connection.providerName} is connected, but no default model is picked yet.`
              : 'Connect a provider (API key or sign-in) and pick a default model — it takes about a minute.'}
          </p>
        )}

        <ReadySummary rows={rows} onJumpTo={onJumpTo} />
      </div>

      {ready ? (
        <StepActions onClick={onComplete}>
          Start chatting <ArrowRight className="size-4" />
        </StepActions>
      ) : (
        <StepActions
          onClick={() => onJumpTo('provider')}
          secondary={{ label: 'Finish without a model', onClick: onComplete }}
        >
          <Plug className="size-4" /> Connect a provider
        </StepActions>
      )}
    </div>
  )
}
