import { useEffect, useState } from 'react'
import { UserRound } from 'lucide-react'
import { HUMAN_AGENT_ID, HUMAN_HANDLE, HUMAN_PROFILE_MAX_CHARS } from '@localixai/agent/agents'
import { settingsEntityUiUri } from '@localixai/mini-app-sdk/navigation'
import { Button } from '@localixai/kit/button'
import { Field } from '@localixai/kit/field'
import { Input } from '@localixai/kit/input'
import { Textarea } from '@localixai/kit/textarea'
import { backendClient } from '@/shared/api/client'
import type { AgentSummary } from '@/shared/api/contracts'
import { errorMessage } from '@localixai/mini-app-sdk/ui/utilities'
import { invalidateHumanProfiles, useHumanProfile } from '@/shared/contrib/humanProfile'
import { SettingRegistryMeta, SettingRegistryRow } from '../settingRegistry'

interface Draft {
  label: string
  description: string
  instructions: string
}

const draftOf = (summary: AgentSummary | undefined): Draft => ({
  label: summary?.record.label ?? '',
  description: summary?.record.description ?? '',
  instructions: summary?.record.instructions ?? '',
})

/**
 * THE PERSON'S CARD, pinned beside Localix: who the agents work with (`@human`).
 *
 * Only what describes a person — a title, a description and notes — because the record is never
 * run: no model, tools, skills, permissions or priority, and nothing to delete or switch off. The
 * scope picker above decides where a save lands; a project without its own card shows the
 * installation's, and Restore steps back to it.
 */
export function HumanAgentCard({ scope }: { scope: string }) {
  const summary = useHumanProfile(scope)
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<Draft>(() => draftOf(summary))
  const [busy, setBusy] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  useEffect(() => {
    if (!open) setDraft(draftOf(summary))
  }, [summary, open])

  const used = draft.description.length + draft.instructions.length
  const over = used > HUMAN_PROFILE_MAX_CHARS
  const overridden = Boolean(summary && summary.source !== 'builtin')
  const record = summary?.record

  const run = async (label: string, write: () => Promise<unknown>) => {
    setBusy(label)
    setProblem(null)
    try {
      await write()
      invalidateHumanProfiles()
      setOpen(false)
    } catch (error) {
      setProblem(errorMessage(error, 'Could not save.'))
    } finally {
      setBusy(null)
    }
  }

  const save = () =>
    run('Saving Human', () =>
      backendClient.updateAgent(
        HUMAN_HANDLE,
        {
          kind: 'human',
          handle: HUMAN_HANDLE,
          ...(draft.label.trim() ? { label: draft.label.trim() } : {}),
          description: draft.description.trim(),
          instructions: draft.instructions.trim(),
          projectId: scope || null,
        } as never,
        scope || null,
      ),
    )

  return (
    <SettingRegistryRow
      uiTargetUri={settingsEntityUiUri('agents', 'agent', HUMAN_AGENT_ID, scope)}
      state="enabled"
      busyLabel={busy ?? undefined}
      leading={
        <span className="inline-flex size-7 items-center justify-center rounded-full bg-field-fill text-text-soft">
          <UserRound className="size-4" aria-hidden />
        </span>
      }
      actions={
        <Button onClick={() => setOpen((value) => !value)} disabled={Boolean(busy)}>
          {open ? 'Close' : 'Edit'}
        </Button>
      }
      header={
        <>
          <div className="flex min-w-0 items-baseline gap-2">
            <p className="min-w-0 truncate text-sm font-semibold text-foreground">
              {record?.label || 'Human'}
            </p>
            <code className="shrink-0 text-2xs text-text-soft">{HUMAN_HANDLE}</code>
          </div>
          <SettingRegistryMeta
            items={[{ label: 'You — never run' }, ...(overridden ? [{ label: 'customized' }] : [])]}
          />
          <p className="mt-1 truncate text-xs text-text-faint" title={record?.description}>
            {record?.description || 'The person you work with'}
          </p>
        </>
      }
    >
      {open && (
        <form
          className="mt-3 flex flex-col gap-3"
          aria-label="Human"
          onSubmit={(event) => {
            event.preventDefault()
            if (!over) void save()
          }}
        >
          <Field label="Title" description="How agents name you." optional>
            <Input
              size="xl"
              maxLength={60}
              placeholder="Human"
              value={draft.label}
              onChange={(e) => setDraft({ ...draft, label: e.target.value })}
            />
          </Field>
          <Field label="Description" description="Who you are and what you do here." optional>
            <Textarea
              size="xl"
              className="min-h-16 resize-y"
              placeholder="Manual QA — I verify releases by hand"
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            />
          </Field>
          <Field
            label="Notes for agents"
            description="What to ask you for and how. Agents read it as information about you."
            optional
            {...(over ? { error: `Over ${HUMAN_PROFILE_MAX_CHARS} characters` } : {})}
          >
            <Textarea
              size="xl"
              className="min-h-20 resize-y"
              placeholder="Ask me before anything that touches production."
              value={draft.instructions}
              onChange={(e) => setDraft({ ...draft, instructions: e.target.value })}
            />
          </Field>
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={over ? 'text-2xs text-status-error' : 'text-2xs text-text-soft'}
              aria-live="polite"
            >
              {used}/{HUMAN_PROFILE_MAX_CHARS}
            </span>
            {problem && <span className="text-2xs text-status-error">{problem}</span>}
            <span className="flex-1" />
            {overridden && (
              <Button
                type="button"
                disabled={Boolean(busy)}
                onClick={() =>
                  void run('Restoring Human', () =>
                    backendClient.resetAgent(HUMAN_HANDLE, scope || null),
                  )
                }
              >
                Restore
              </Button>
            )}
            <Button type="submit" variant="mono" disabled={Boolean(busy) || over}>
              Save
            </Button>
          </div>
        </form>
      )}
    </SettingRegistryRow>
  )
}
