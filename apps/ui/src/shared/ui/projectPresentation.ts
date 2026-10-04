import { Folder, FolderPlus, Globe, type LucideIcon } from 'lucide-react'

/**
 * How a project — and the absence of one — is DRAWN, in one place.
 *
 * Every list that names projects drew its own: the composer chip said "No folder" beside a
 * Folder, the batch bar's "Move to project" said "No project" beside a House (the glyph of a
 * "Home" scope that no longer exists), and settings put a Globe on the same choice. One concept
 * read as three, so a person could not tell whether "No folder" and "No project" were the same
 * place. The wording is the product's — "No project" — and the Globe is the settings switcher's,
 * because no-project IS the global place (`~/.localix` rather than a working directory).
 */
export interface ProjectPresentation {
  label: string
  icon: LucideIcon
}

/** The glyph of a project row, whatever its name. */
export const PROJECT_ICON: LucideIcon = Folder

/** The choice that belongs to no project. */
export const NO_PROJECT: ProjectPresentation = { label: 'No project', icon: Globe }

/** The action that registers a working directory as a new project. */
export const ADD_PROJECT_FOLDER: ProjectPresentation = { label: 'Add folder…', icon: FolderPlus }

/** Label and icon for a project, or for "No project" when there is none. */
export function projectPresentation(
  project: { name: string } | null | undefined,
): ProjectPresentation {
  return project ? { label: project.name, icon: PROJECT_ICON } : NO_PROJECT
}
