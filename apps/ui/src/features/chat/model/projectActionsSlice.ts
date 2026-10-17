import type { StoreApi } from 'zustand'

import { backendClient } from '@/shared/api/client'
import type { Project, UiSession } from '@/shared/api/contracts'
import { recordProjectUse } from '@/shared/lib/projectMru'
import {
  forgetActiveProjectId,
  forgetLastWorkspace,
  loadRememberedActiveSession,
} from './persistence'
import { sessionBelongsToScope } from './sessionListHelpers'
import type { ChatStore, CustomSet } from './store'
import { scopedNewConversation } from './conversationStartStrategy'

export interface ProjectActionsDeps {
  set: StoreApi<ChatStore>['setState']
  customSet: CustomSet
  get: () => ChatStore
}

/** The project-management actions slice of the chat store. */
export interface ProjectActions {
  loadProjects: () => Promise<void>
  /**
   * The URL→store scope reducer. The URL is the single source of truth for the
   * active scope: this is the ONLY writer of `activeProjectId`, and it is called
   * ONLY by the ChatPage URL→store sync when the route's project segment changes.
   * UI event handlers must NEVER call it to "change scope" — they navigate the
   * URL (`nav.switchProject` / `nav.goToSession`) and let the sync run this.
   */
  selectProject: (id: string | null) => Promise<void>
  /**
   * The chat the neutral landing (`/`) opens: reuse-or-create in the DEFAULT project.
   *
   * "Home" used to be a project-less scope of its own, and this minted a session with
   * `projectId: null`. The server files every session under a project now, so such a draft
   * came back belonging to the default project while the client still believed it was
   * project-less — and the sidebar, which filters by scope, then could not show the chat it
   * had just created.
   */
  createHomeDraft: () => Promise<UiSession | null>
  createProject: (name: string, workingDir: string) => Promise<Project>
  updateProject: (id: string, name: string, workingDir: string) => Promise<Project>
  deleteProject: (id: string) => Promise<void>
  setIsCreatingProject: (value: boolean) => void
  setEditingProject: (project: Project | null) => void
}

export function createProjectActions({ set, customSet, get }: ProjectActionsDeps): ProjectActions {
  return {
    loadProjects: async () => {
      const projects = await backendClient.listProjects()
      // Through the store's single fetched-roster writer, so `projectsLoaded` can never be
      // true for one entry point and false for the other.
      get()._hydrateProjects(projects)
    },

    selectProject: async (id) => {
      // Feed the project quick-switcher's "Open Recent" ordering. Only real
      // projects are tracked — `null` is the project-less Home, not a switch
      // target.
      if (id) recordProjectUse(id)
      const state = get()

      // Resolve the default session for the scope (the per-project remembered
      // one, else the first root/leaf chat). When the URL also carries a session
      // id, the sync's follow-up selectSession corrects to it; when it doesn't,
      // the ChatPage normalization redirect stamps this resolved id into the URL.
      const projectSessions = state.allSessions.filter((session) =>
        sessionBelongsToScope(session, id),
      )
      const firstRootSession = projectSessions.find((s) => !s.parentSessionId)
      const remembered = loadRememberedActiveSession(id)
      const activeSessionId =
        remembered && projectSessions.some((s) => s.id === remembered)
          ? remembered
          : (firstRootSession?.id ?? projectSessions[0]?.id ?? null)
      // Not recorded here: this is a proposal the URL settles on (the normalization redirect),
      // and the location ledger records the route once it does.

      customSet({
        activeProjectId: id,
        activeSessionId,
      })
      // Do not hydrate a default body here. The URL is the navigation authority:
      // a bare scope is normalized to this resolved id, then the routed-session
      // sync performs the single cancellable detail load. When the URL already
      // names a session, fetching the default first only delayed the intended
      // conversation and made one project switch issue two detail requests.
      // A project with no sessions intentionally leaves activeSessionId null: the
      // workspace shows an empty composer scoped to this project. A session is
      // created only on an explicit "New chat" (the project's "+" button) or when
      // the user sends the first message — never automatically on open.
    },

    createHomeDraft: async () => {
      // The DEFAULT project's scope, passed EXPLICITLY so the draft lands there whatever
      // the current activeProjectId is — scope is not mutated here (the URL owns it; the
      // caller navigates right after). `createSession` owns the per-scope in-flight latch,
      // so a re-fired home effect (or a fresh-chat send racing this) joins the pending
      // creation and lands on the SAME draft instead of double-creating.
      //
      // A LANDING, not a New chat: the server answers with the project's newest untouched chat
      // when there is one, so windows landing together (a launch, a dead project route in each
      // restored window) converge on one chat instead of leaving an empty one each.
      //
      // Without a roster yet, omit the id and let the server file it: its answer carries
      // the project, and that is the value the store records.
      const fallback = get().projects.find((project) => project.isDefault)?.id
      return await get().createSession(
        undefined,
        scopedNewConversation(fallback ?? null, { kind: 'default' }, true),
      )
    },

    createProject: async (name, workingDir) => {
      const newProject = await backendClient.createProject(name, workingDir)
      customSet((state) => ({
        projects: [...state.projects, newProject],
      }))
      return newProject
    },

    updateProject: async (id, name, workingDir) => {
      const updated = await backendClient.updateProject(id, { name, workingDir })
      customSet((state) => ({
        projects: state.projects.map((p) => (p.id === id ? updated : p)),
      }))
      return updated
    },

    deleteProject: async (id) => {
      // DATA mutation only: delete the project and drop its sessions from the client's
      // roster. They are NOT reparented — the server soft-deletes the project and its
      // sessions keep pointing at it, which is the whole reason deletion is soft: a
      // re-added directory revives the row and its chats come back with it. Reparenting
      // them to a project-less scope here (what this used to do) would have orphaned them
      // in the client's head while the server disagreed.
      //
      // Scope changes are URL-driven — if the deleted project was the active scope, the
      // caller navigates away. This action never mutates activeProjectId itself.
      await backendClient.deleteProject(id)
      const state = get()
      const projects = state.projects.filter((p) => p.id !== id)
      if (state.activeProjectId === id) {
        forgetActiveProjectId()
        // The launch-restore pair pointed at this project. Leaving it would cost the next
        // launch a full projects-roster wait only to discover the project is gone.
        forgetLastWorkspace()
      }

      const allSessions = state.allSessions.filter((s) => s.projectId !== id)

      customSet({ projects, allSessions })
    },

    setIsCreatingProject: (value) => set({ isCreatingProject: value }),
    setEditingProject: (project) => set({ editingProject: project }),
  }
}
