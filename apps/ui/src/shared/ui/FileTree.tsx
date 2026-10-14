import { FileTree as SharedFileTree } from '@localixai/markdown/FileTree'
import { fileIcon, folderIcon } from './file-icon/fileIcon'

/** Workspace icons over the shared, keyboard-accessible Markdown tree. */
export function FileTree({ source }: { source: string }) {
  return (
    <SharedFileTree
      source={source}
      getIcon={(row, open) => (row.folder ? folderIcon(open) : fileIcon(row.name))}
    />
  )
}
