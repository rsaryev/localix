import { useEffect, useRef, useState } from 'react'
import { errorMessage } from '@localixai/plugin-sdk/ui/utilities'
import { GeneralSettings } from './GeneralSettings'
import { SettingsSearch } from './SettingsSearch'
import { PreferencesSettings } from './PreferencesSettings'
import { EditorSettings } from './EditorSettings'
import { KeyboardShortcutsSettings } from './KeyboardShortcutsSettings'
import { CapabilitiesSettings } from './CapabilitiesSettings'
import { AgentsSettings } from './AgentsSettings'
import { DiagnosticsSettings } from './DiagnosticsSettings'
import { ProjectSettingsForm } from './ProjectsSettings'
import type { Project } from '@/shared/api/contracts'
import { backendClient } from '@/shared/api/client'
import { toast } from '@/shared/lib/notify'
import { reportProjectListFailure, reportProjectListLoaded } from '../model/projectListProblem'
import { prefersReducedMotion } from '@localixai/kit/environment'
import { useUiNavigation } from '@/shared/hooks/useUiNavigation'
import { TabBar } from '@localixai/kit/tabs'
import { ProjectScopeSelect } from './ScopeSwitcher'
import { isCapabilityTab, parseSettingsTab, type SettingsTabId } from '@/shared/routing/routes'
import { subscribeSettingsNav, consumeSettingsNav } from '@/shared/lib/settingsNavBus'
import { useWorkItemVisible } from '@localixai/plugin-sdk/ui/visibility'
import { useSettingsAnchorMaterializer } from '../model/useSettingsAnchorMaterializer'
import { navigateUi } from '@/shared/lib/uiNavigation'
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

/**
 * Settings lives in the inspector panel (not a wide dialog), so it uses a single
 * top-tab layout instead of the old left nav sidebar, which felt cramped in a
 * narrow split. Projects are a tab too: the Project tab carries a dropdown that picks which project (or creates one),
 * and the chosen project's settings render below. Content fills the full width
 * and centers at a readable max-width when the panel is widened/maximized.
 */
export function SettingsPanel({
  activeTab: activeTabProp,
  onTabChange: onTabChangeProp,
  defaultScope,
}: SettingsPanelProps) {
  const workItemVisible = useWorkItemVisible()
  // Settings is app-level: it acts for no chat, so a link out of it opens nothing chat-scoped.
  const uiNavigation = useUiNavigation({ sessionId: null })
  const contentRef = useRef<HTMLDivElement>(null)
  const [requestedCapabilityScope, setRequestedCapabilityScope] = useState<string | null>(null)
  // The Agents page picks a project of its own: an agent record is stored globally or in
  // one project, and that choice is unrelated to which scope's ceiling you were last
  // editing on the Capabilities page.
  const [agentsScope, setAgentsScope] = useState(defaultScope ?? '')
  const [projects, setProjects] = useState<Project[]>([])
  // When rendered without controlling props (the grid mounts it bare), the panel
  // owns its own tab state so the tab bar still switches.
  const [internalTab, setInternalTab] = useState<SettingsTabId>('general')
  const activeTab = activeTabProp ?? internalTab
  const onTabChange = onTabChangeProp ?? setInternalTab

  useEffect(() => {
    if (!workItemVisible) return
    let cancelled = false
    backendClient
      .listProjects()
      .then((p) => {
        reportProjectListLoaded()
        if (!cancelled) setProjects(p)
      })
      .catch(reportProjectListFailure)
    return () => {
      cancelled = true
    }
  }, [workItemVisible])

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
        onTabChange(parseSettingsTab(tab, undefined))
        setRequestedCapabilityScope(scope ?? null)
        consumeSettingsNav()
      }),
    [onTabChange],
  )

  // Global search navigates to a settings SECTION, and a section only exists once its tab
  // is on screen; the bridge that waits for it lives in its own hook.
  useSettingsAnchorMaterializer(contentRef)

  const onProjectTab = isProjectTab(activeTab)
  const activeProjId = onProjectTab ? activeTab.id : null
  // The primary tab bar tracks string tabs; a project view maps to the 'project' tab.
  const primaryActive: string = onProjectTab
    ? 'project'
    : isCapabilityTab(activeTab)
      ? 'tools'
      : activeTab

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
      setProjects((prev) => [...prev, proj])
      onTabChange?.({ kind: 'project', id: proj.id })
    } catch (error) {
      toast.error('Could not add the project folder', {
        description: errorMessage(error, '') || undefined,
      })
    }
  }

  // Clicking the Project tab resolves to a concrete project: keep the current one,
  // else the first project, else jump straight into creating one (the only action
  // available with no projects).
  const onPrimaryTabChange = (id: string) => {
    if (id !== 'project') return onTabChange?.(id as SettingsTabId)
    if (onProjectTab) return
    if (projects.length > 0) onTabChange?.({ kind: 'project', id: projects[0].id })
    else void addProject()
  }

  function renderContent() {
    if (activeTab === 'general') return <GeneralSettings />
    if (activeTab === 'preferences') return <PreferencesSettings />
    if (activeTab === 'editor') return <EditorSettings />
    if (activeTab === 'shortcuts') return <KeyboardShortcutsSettings />
    if (activeTab === 'diagnostics') return <DiagnosticsSettings />
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
    if (onProjectTab) {
      const proj = projects.find((p) => p.id === activeTab.id)
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
              project={proj}
              onSaved={(updated) =>
                setProjects((prev) => prev.map((p) => (p.id === updated.id ? updated : p)))
              }
              onDeleted={(id) => {
                setProjects((prev) => prev.filter((p) => p.id !== id))
                onTabChange?.('general')
              }}
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
    <div className="flex h-full w-full flex-col overflow-hidden">
      {/* Header: primary tabs. No PanelHeader — the inspector tab strip already
          shows the "Settings" title + controls. */}
      <div className="shrink-0 border-b border-border-soft">
        <TabBar
          aria-label="Settings sections"
          // Gutters only: the row's height and seam belong to TabBar. The old `pt-2`
          // was a nudge against its former asymmetric padding pair.
          className="min-w-0 px-4"
          items={[
            { id: 'general', label: 'General' },
            { id: 'preferences', label: 'Preferences' },
            { id: 'editor', label: 'Editor' },
            { id: 'shortcuts', label: 'Shortcuts' },
            { id: 'agents', label: 'Agents' },
            { id: 'tools', label: 'Capabilities' },
            { id: 'diagnostics', label: 'Diagnostics' },
            { id: 'project', label: 'Project' },
          ]}
          active={primaryActive}
          onChange={onPrimaryTabChange}
        />
        <div className="w-full px-5 pb-4 pt-3">
          <SettingsSearch className="w-full" onNavigate={(uri) => navigateUi(uri, uiNavigation)} />
        </div>
      </div>

      <div ref={contentRef} data-ui-scroll-container className="min-w-0 flex-1 overflow-y-auto">
        <div className="@container w-full px-5 py-6">{renderContent()}</div>
      </div>
    </div>
  )
}
