// The active file of the editor grid, derived from its focused group. Opening a file and the
// recent-files list live in `@/shared/lib/recentFiles`.
import { useGridStore, focusedFilePath } from '@/entities/workspace-grid/model'

/** Path of the file shown in the FOCUSED grid group (file or diff), for the file
 *  tree / symbol palette active-row highlight. Scope-aware: never reports a
 *  background session's file after a switch (see `focusedFilePath`). */
export function useActiveFilePath(): string | null {
  return useGridStore(focusedFilePath)
}
