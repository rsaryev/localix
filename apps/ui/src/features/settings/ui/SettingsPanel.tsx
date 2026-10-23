import { useEffect, useRef, useState } from 'react'
import { ModelsSettings } from './ModelsSettings'
import { errorMessage } from '@localixai/mini-app-sdk/ui/utilities'
import { SettingsSearch } from './SettingsSearch'
import { PreferencesSettings } from './PreferencesSettings'
import { EditorSettings } from './EditorSettings'
import { KeyboardShortcutsSettings } from './KeyboardShortcutsSettings'
import { CapabilitiesSettings } from './CapabilitiesSettings'
import { AgentsSettings } from './AgentsSettings'
import { SystemSettings } from './SystemSettings'
import { ProjectSettingsForm } from './ProjectsSettings'
import { backendClient } from '@/shared/api/client'
import { toast } from '@/shared/lib/notify'
import { useSettingsProjects } from '../model/useSettingsProjects'
import { prefersReducedMotion } from '@localixai/kit/environment'
import { useUiNavigation } from '@/shared/hooks/useUiNavigation'
import { SettingsNavigation } from './SettingsNavigation'
import { SettingsWorkspace } from './SettingsWorkspace'
import { ProjectScopeSelect } from './ScopeSwitcher'
import { isCapabilityTab, parseSettingsTab, type SettingsTabId } from '@/shared/routing/routes'
import { subscribeSettingsNav, consumeSettingsNav } from '@/shared/lib/settingsNavBus'
import { useSettingsAnchorMaterializer } from '../model/useSettingsAnchorMaterializer'
import { navigateUi } from '@/shared/lib/uiNavigation'
import { primarySettingsSection } from '../model/settingsNavigation'
import { SectionLabel } from '@localixai/kit/section-label'

export type { SettingsTabId }

function isProjectTab(tab: SettingsTabId): tab is { kind: 'project'; id: string } {
  return typeof tab === 'object' && tab.kind === 'project'
}

interface SettingsPanelProps {
  activeTab?: SettingsTabId
  onTabChange?: (tab: SettingsTabId) => void
  /** Active project id ('' / undefined = no project) — defaults the Capabilities scope picker. */
  defaultScope?: string
}

/** Settings adapts to its pane: grouped navigation when wide, a section picker when narrow. */
export function SettingsPanel({
  activeTab: activeTabProp,
  onTabChange: onTabChangeProp,
  defaultScope,
}: SettingsPanelProps) {
  // Settings is app-level: it acts for no chat, so a link out of it opens nothing chat-scoped.
  const uiNavigation = useUiNavigation({ sessionId: null })
  const contentRef = useRef<HTMLDivElement>(null)
  const [requestedCapabilityScope, setRequestedCapabilityScope] = useState<string | null>(null)
  // The Agents page picks a project of its own: an agent record is stored globally or in
  // one project, and that choice is unrelated to which scope's ceiling you were last
  // editing on the Capabilities page.
  const [agentsScope, setAgentsScope] = useState(defaultScope ?? '')
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
        setRequestedCapabilityScope(scope ?? null)
        consumeSettingsNav()
      }),
    [onTabChange],
  )

  // Global search navigates to a settings SECTION, and a section only exists once its tab
  // is on screen; the bridge that waits for it lives in its own hook.
  useSettingsAnchorMaterializer(contentRef)

  const onProjectTab = isProjectTab(activeTab)
  const activeProjId = onProjectTab ? activeTab.id : defaultScope || projects[0]?.id || null
  // The primary tab bar tracks string tabs; a project view maps to the 'project' tab.
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
    if (activeTab === 'agents') {
      return (
        <AgentsSettings scope={agentsScope} projects={projects} onScopeChange={setAgentsScope} />
      )
    }
    if (isCapabilityTab(activeTab)) {
      return (
        <CapabilitiesSettings
          activeTab={activeTab}
          onTabChange={(tab) => onTabChange?.(tab)}
          projects={projects}
          defaultScope={requestedCapabilityScope ?? defaultScope}
        />
      )
    }
    if (onProjectTab || activeTab === 'project') {
      const proj = projects.find((p) => p.id === activeProjId)
      return (
        <div className="space-y-5">
          {/* Scope selector — which project these settings apply to. */}
          <div className="flex items-center gap-2">
            <SectionLabel as="span" weight="semibold">
              Project
            </SectionLabel>
            <ProjectScopeSelect
              projects={projects}
              activeId={activeProjId}
              onSelect={(id) => onTabChange?.({ kind: 'project', id })}
              onCreate={() => {
                void addProject()
              }}
            />
          </div>
          {proj ? (
            <ProjectSettingsForm
              key={proj.id}
              project={proj}
              onDeleted={() => onTabChange?.('preferences')}
            />
          ) : (
            <p className="text-sm text-text-soft">Select a project above, or create one.</p>
          )}
        </div>
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
