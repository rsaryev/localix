import { useState, useCallback, useRef } from 'react'
import { Button } from '@localixai/kit/button'
import { ConfirmDialog } from '@localixai/kit/confirm-dialog'
import { Input } from '@localixai/kit/input'
import { Textarea } from '@localixai/kit/textarea'
import { backendClient } from '@/shared/api/client'
import { PROJECT_CUSTOM_SYSTEM_PROMPT_MAX_CHARS, type Project } from '@/shared/api/contracts'
import { inlineFailure } from '@/shared/lib/notifications/inlineReport'
import { SettingsPageHeader, SettingsSection, SettingsSurface } from './SettingsScaffold'
import { SettingsActionActivity } from './SettingsActionActivity'

export interface ProjectSettingsFormProps {
  project: Project
  onSaved: (p: Project) => void
  onDeleted?: (id: string) => void
}

export function ProjectSettingsForm({ project, onSaved, onDeleted }: ProjectSettingsFormProps) {
  const [name, setName] = useState(project.name)
  const [systemPrompt, setSystemPrompt] = useState(project.settings?.customSystemPrompt ?? '')
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [mutationError, setMutationError] = useState<string | null>(null)
  // Blur-driven name/prompt saves can happen back-to-back while tabbing through
  // the form. Preserve their intent order instead of racing two project patches,
  // and let only the newest queued save own the visible status.
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve())
  const saveVersionRef = useRef(0)

  const save = useCallback(
    (overrides?: { name?: string; systemPrompt?: string }) => {
      const version = ++saveVersionRef.current
      const request = {
        name: (overrides?.name ?? name).trim() || project.name,
        workingDir: project.workingDir,
        settingsPatch: {
          customSystemPrompt: (overrides?.systemPrompt ?? systemPrompt).trim() || null,
        },
      }
      setSaving(true)
      setMutationError(null)
      const queued = saveQueueRef.current
        .catch(() => undefined)
        .then(async () => {
          try {
            const updated = await backendClient.updateProject(project.id, request)
            onSaved(updated)
            if (version === saveVersionRef.current) setMutationError(null)
          } catch (error) {
            if (version === saveVersionRef.current) {
              setMutationError(inlineFailure(error, 'Could not save the project settings.'))
            }
          } finally {
            if (version === saveVersionRef.current) setSaving(false)
          }
        })
      saveQueueRef.current = queued
      return queued
    },
    [project, name, systemPrompt, onSaved],
  )

  const handleDelete = async () => {
    setDeleting(true)
    setMutationError(null)
    try {
      await saveQueueRef.current
      await backendClient.deleteProject(project.id)
      onDeleted?.(project.id)
    } catch (error) {
      setMutationError(inlineFailure(error, 'Could not delete the project.'))
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="space-y-8">
      {/* The shared heading, not a local copy of it: this one had its own weight and no
          responsive step, so the title changed shape when you navigated between settings
          tabs. The working directory sits under it rather than in the header's description,
          because it is a path — monospaced and truncating — and not a sentence. */}
      <div className="space-y-0.5 border-b border-border-faint pb-5">
        <SettingsPageHeader title={project.name} />
        <p className="truncate font-mono text-xs text-text-soft" title={project.workingDir}>
          {project.workingDir}
        </p>
      </div>

      <SettingsSection title="Display name" anchor="project-name" scope="project">
        <SettingsSurface>
          <Input
            size="xl"
            aria-label="Display name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              void save({ name })
            }}
            placeholder="Project name"
          />
        </SettingsSurface>
      </SettingsSection>

      <SettingsSection
        title="Project instructions"
        anchor="project-instructions"
        scope="project"
        description="Applied to every agent run in this project. Use it to set project-specific context, coding conventions, or rules."
      >
        <SettingsSurface>
          <Textarea
            size="xl"
            className="min-h-36 resize-y"
            aria-label="Custom system prompt"
            placeholder="E.g. This project uses Bun + Hono. Always prefer explicit types. Run tests before committing."
            value={systemPrompt}
            maxLength={PROJECT_CUSTOM_SYSTEM_PROMPT_MAX_CHARS}
            onChange={(e) => setSystemPrompt(e.target.value)}
            onBlur={() => {
              void save({ systemPrompt })
            }}
          />
        </SettingsSurface>
      </SettingsSection>

      {saving && (
        <div className="text-xs text-text-soft" role="status">
          <SettingsActionActivity label="Saving project" />
        </div>
      )}
      {mutationError && (
        <p role="alert" className="text-xs text-status-error">
          {mutationError}
        </p>
      )}

      {/* No danger zone on the DEFAULT project: it is where every chat without a project
          lands, the server refuses to delete it, and the row is revived on the next session
          anyway — so the button could only hide the user's own chats until something
          recreated it. Renaming it is still offered above; identity is the directory. */}
      {project.isDefault ? (
        <section className="space-y-2 pt-2">
          <p className="text-xs text-text-soft">
            This is the default project — where chats you start without one live. It cannot be
            deleted. Open a real project to keep work somewhere you own.
          </p>
        </section>
      ) : (
        <section className="space-y-2 pt-2">
          <h3 className="text-xs font-medium text-status-error/85">Danger zone</h3>
          <div className="flex flex-col items-stretch justify-between gap-3 border-y border-status-error/15 py-3 @xl:flex-row @xl:items-center">
            <div className="space-y-0.5">
              <p className="text-sm font-medium text-foreground">Delete project</p>
              {/* What actually happens — a SOFT delete (`projects/service.ts`). The old copy
                  promised the conversations were destroyed, which is wrong in both directions:
                  nothing is shredded, and re-opening the same directory brings it all back. */}
              <p className="text-xs text-text-soft">
                Hides the project. Its conversations, files and rules stay; re-opening the same
                directory brings it back.
              </p>
            </div>
            <Button
              variant="destructive"
              size="lg"
              onClick={() => setConfirmDelete(true)}
              disabled={deleting}
              aria-busy={deleting || undefined}
              className="shrink-0"
            >
              {deleting ? <SettingsActionActivity label="Deleting project" /> : 'Delete project'}
            </Button>
          </div>
        </section>
      )}

      {/* The app's confirmation, not an inline "Sure?" — the row it sat in was a hover away from
          the button that armed it. The description states what the server does rather than what
          the word "delete" suggests: the sessions and the capability rules survive. */}
      <ConfirmDialog
        open={confirmDelete}
        title={`Delete ${project.name}?`}
        description="It disappears from the sidebar. Its conversations and rules are kept, and re-opening the same directory restores it."
        confirmLabel="Delete project"
        onConfirm={() => {
          setConfirmDelete(false)
          void handleDelete()
        }}
        onClose={() => setConfirmDelete(false)}
      />
    </div>
  )
}
