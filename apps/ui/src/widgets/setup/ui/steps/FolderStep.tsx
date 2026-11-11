import { PERMISSION_MODE_COPY, PERMISSION_MODES } from '@localixai/api/permission-modes'
import { Button } from '@localixai/kit/button'
import { Select } from '@localixai/kit/select'
import { SectionLabel } from '@localixai/kit/section-label'
import { useChatStore } from '@/entities/chat/model/store'
import { useAddProjectFolder } from '@/entities/chat/model/useAddProjectFolder'
import { SettingsControlRow, SettingsRows } from '@/features/settings/ui/SettingsScaffold'
import { useRoutedNavigation } from '@/shared/hooks/useRoutedNavigation'
import { ADD_PROJECT_FOLDER } from '@/shared/ui/projectPresentation'
import { SettingsLink, SetupLater } from '../SetupLater'

/**
 * Step two: the folder the agent works in, and the one line about what it may do there. The
 * folder picker is the app's own (`useAddProjectFolder`: choosing a folder that is already a
 * project switches to it); the modes are the composer's, read from the shared list.
 */
export function FolderStep() {
  const addFolder = useAddProjectFolder()
  const nav = useRoutedNavigation()
  const projects = useChatStore((s) => s.projects)
  const activeId = useChatStore((s) => s.activeProjectId)
  const folders = projects.filter((p) => !p.isDefault)
  const active = folders.find((p) => p.id === activeId)

  return (
    <>
      <p className="max-w-prose text-sm leading-6 text-text-soft text-pretty">
        The agent reads and edits the files in the folder you choose, and runs commands there.
        Without one, each conversation works in a scratch folder of its own.
      </p>
      <SettingsRows className="mt-4">
        <SettingsControlRow
          title="Working folder"
          description={
            active ? (
              <span className="font-mono break-all">{active.workingDir}</span>
            ) : (
              'None: conversations use their own scratch folders.'
            )
          }
        >
          {folders.length > 1 && (
            <Select
              size="xl"
              aria-label="Switch to a folder"
              placeholder="Switch to…"
              className="w-full @xl:w-44"
              value={active?.id ?? ''}
              onValueChange={(id) => nav.switchProject(id)}
              options={folders.map((p) => ({ value: p.id, label: p.name }))}
            />
          )}
          <Button size="xl" variant={active ? 'field' : 'mono'} onClick={() => void addFolder()}>
            {active ? ADD_PROJECT_FOLDER.label : 'Choose folder…'}
          </Button>
        </SettingsControlRow>
      </SettingsRows>

      <SectionLabel as="h4" className="mt-6 pb-1">
        What the agent may do
      </SectionLabel>
      <p className="max-w-prose text-sm leading-6 text-text-soft text-pretty">
        A conversation starts in Default mode, unless your Claude Code settings name another. The
        mode chip above the message box switches it:
      </p>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs leading-5">
        {PERMISSION_MODES.map((mode) => (
          <div key={mode} className="contents">
            <dt className="font-medium text-foreground">{PERMISSION_MODE_COPY[mode].label}</dt>
            <dd className="text-text-soft text-pretty">{PERMISSION_MODE_COPY[mode].hint}</dd>
          </div>
        ))}
      </dl>
      <SetupLater>
        the project chip above the message box; rules in{' '}
        <SettingsLink tab="permissions">Permissions</SettingsLink>.
      </SetupLater>
    </>
  )
}
