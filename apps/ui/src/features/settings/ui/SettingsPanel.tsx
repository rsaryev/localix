import { useEffect, useRef, useState } from 'react'
import { ModelsSettings } from './ModelsSettings'
import { errorMessage } from '@localixai/mini-app-sdk/ui/utilities'
import { SettingsSearch } from './SettingsSearch'
import { PreferencesSettings } from './PreferencesSettings'
import { EditorSettings } from './EditorSettings'
import { KeyboardShortcutsSettings } from './KeyboardShortcutsSettings'
import { SystemSettings } from './SystemSettings'
import { PermissionsSettings } from './permissions/PermissionsSettings'
import { ProjectSettingsForm } from './ProjectsSettings'
import { backendClient } from '@/shared/api/client'
import { toast } from '@/shared/lib/notify'
import { useSettingsProjects } from '../model/useSettingsProjects'
import { prefersReducedMotion } from '@localixai/kit/environment'
import { useUiNavigation } from '@/shared/hooks/useUiNavigation'
import { SettingsNavigation } from './SettingsNavigation'
import { SettingsWorkspace } from './SettingsWorkspace'
import { ProjectScopeSelect } from './ScopeSwitcher'
import { parseSettingsTab, type SettingsTabId } from '@/shared/routing/routes'
import { subscribeSettingsNav, consumeSettingsNav } from '@/shared/lib/settingsNavBus'
import { useSettingsAnchorMaterializer } from '../model/useSettingsAnchorMaterializer'
import { navigateUi } from '@/shared/lib/uiNavigation'
import { primarySettingsSection } from '../model/settingsNavigation'
import { SettingsPage } from './SettingsScaffold'

export type { SettingsTabId }

function isProjectTab(tab: SettingsTabId): tab is { kind: 'project'; id: string } {
  return typeof tab === 'object' && tab.kind === 'project'
}

interface SettingsPanelProps {
  activeTab?: SettingsTabId
  onTabChange?: (tab: SettingsTabId) => void
  /** Active project id ('' / undefined = no project) — defaults the project the Permissions page opens on. */
  defaultScope?: string
}

/** Settings adapts to its pane: grouped navigation when wide, search over a tab strip when narrow. */
export function SettingsPanel({
  activeTab: activeTabProp,
  onTabChange: onTabChangeProp,
  defaultScope,
}: SettingsPanelProps) {
  // Settings is app-level: it acts for no chat, so a link out of it opens nothing chat-scoped.
  const uiNavigation = useUiNavigation({ sessionId: null })
  const contentRef = useRef<HTMLDivElement>(null)
  const [requestedScope, setRequestedScope] = useState<string | null>(null)
  const projects = useSettingsProjects()
  // When rendered without controlling props (the grid mounts it bare), the panel
  // owns its own tab state so the tab bar still switches.
  const [internalTab, setInternalTab] = useState<SettingsTabId>('preferences')
  const activeTab = activeTabProp ?? internalTab
  const onTabChange = onTabChangeProp ?? setInternalTab

  useEffect(() => {
    contentRef.current?.scrollTo({
      top: 0,
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    })
  }, [activeTab])

  // Deep-link from OUTSIDE (a global-search hit) into a specific tab + section, the same
  // way the internal search does. The bus latches, so an open-Settings-then-navigate
  // sequence still lands after this panel mounts.
  useEffect(
    () =>
      subscribeSettingsNav(({ tab, scope }) => {
        onTabChange(parseSettingsTab(tab, tab === 'project' && scope ? scope : undefined))
        setRequestedScope(scope ?? null)
        consumeSettingsNav()
      }),
    [onTabChange],
  )

  // Global search navigates to a settings SECTION, and a section only exists once its tab
  // is on screen; the bridge that waits for it lives in its own hook.
  useSettingsAnchorMaterializer(contentRef)

  const onProjectTab = isProjectTab(activeTab)
  const activeProjId = onProjectTab ? activeTab.id : defaultScope || projects[0]?.id || null
  // The section navigation tracks string tabs; a project view maps to the 'project' tab.
  const primaryActive = primarySettingsSection(activeTab)

  const addProject = async () => {
    // The sibling entry point for this same action (`useAddProjectFolder`) already
    // reports a failure; this one had no catch at all, so a picker that could not
    // open — no native dialog in this window, and on Linux no zenity/kdialog for
    // the REST fallback either — left "Add project" doing nothing at all, with the
    // reason only in the console.
    try {
      const dir = await backendClient.pickDirectory()
      if (!dir) return
      const name = dir.split('/').pop() ?? 'New project'
      const proj = await backendClient.createProject(name, dir)
      // The 'projects' topic brings the new project into the list.
      onTabChange?.({ kind: 'project', id: proj.id })
    } catch (error) {
      toast.error('Could not add the project folder', {
        description: errorMessage(error, '') || undefined,
      })
    }
  }

  const onPrimaryTabChange = (id: string) => onTabChange(id as SettingsTabId)

  function renderContent() {
    if (activeTab === 'preferences') return <PreferencesSettings />
    if (activeTab === 'editor') return <EditorSettings />
    if (activeTab === 'shortcuts') return <KeyboardShortcutsSettings />
    if (activeTab === 'models' || activeTab === 'model-list') {
      return <ModelsSettings activeTab={activeTab} onTabChange={onTabChange} />
    }
    if (activeTab === 'system' || activeTab === 'context' || activeTab === 'diagnostics') {
      return <SystemSettings activeTab={activeTab} onTabChange={onTabChange} />
    }
    if (activeTab === 'permissions') {
      return <PermissionsSettings projectId={requestedScope ?? defaultScope ?? ''} />
    }
    if (onProjectTab || activeTab === 'project') {
      const proj = projects.find((p) => p.id === activeProjId)
      // Which project these settings apply to: the page header's action, as every page's own.
      const picker = (
        <ProjectScopeSelect
          projects={projects}
          activeId={activeProjId}
          onSelect={(id) => onTabChange?.({ kind: 'project', id })}
          onCreate={() => {
            void addProject()
          }}
        />
      )
      return proj ? (
        <ProjectSettingsForm
          key={proj.id}
          project={proj}
          picker={picker}
          onDeleted={() => onTabChange?.('preferences')}
        />
      ) : (
        <SettingsPage
          title="Project"
          description="Select a project, or create one."
          actions={picker}
        >
          {null}
        </SettingsPage>
      )
    }
    return null
  }

  // No ground coat: the hosting pane already paints one, and under the macOS glass theme the
  // ground tokens carry alpha — a second pane-sized coat compounds into an opaque slab. On the
  // opaque themes the pane's coat is the identical color, so inheriting it changes nothing.
  return (
    <SettingsWorkspace
      contentRef={contentRef}
      navigation={
        <SettingsNavigation
          active={primaryActive}
          onChange={onPrimaryTabChange}
          search={
            <SettingsSearch
              className="w-full"
              onNavigate={(uri) => navigateUi(uri, uiNavigation)}
            />
          }
        />
      }
    >
      {renderContent()}
    </SettingsWorkspace>
  )
}
