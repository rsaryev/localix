import { useMemo } from 'react'
import { Folder, FolderPlus } from 'lucide-react'
import type { Project } from '@/shared/api/contracts'
import type { BreadcrumbSelectItem } from '@localixai/kit/breadcrumb-select'

/**
 * The scope crumb's dropdown: add a project, then every project.
 *
 * Its own module because it is the one segment whose entries carry ICONS, which keeps it out
 * of the navigation model beside it (a `.ts` file cannot hold JSX) and off the bar, which is
 * layout. "Add project…" leads because it is the only entry that is an action rather than a
 * destination, and burying an action under a list of places is how it goes unfound.
 */
export function useScopeCrumbItems(
  projects: Project[],
  activeProjectId: string | null,
  switchProject: (id: string) => void,
  addFolder: () => Promise<unknown> | void,
): BreadcrumbSelectItem[] {
  return useMemo<BreadcrumbSelectItem[]>(
    () => [
      {
        id: '__add_project__',
        label: 'Add project\u2026',
        icon: <FolderPlus className="size-3.5" />,
        active: false,
        onSelect: () => void addFolder(),
      },
      ...projects.map((project) => ({
        id: project.id,
        label: project.name,
        icon: <Folder className="size-3.5" />,
        active: project.id === activeProjectId,
        onSelect: () => switchProject(project.id),
      })),
    ],
    [projects, activeProjectId, switchProject, addFolder],
  )
}
