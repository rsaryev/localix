import type { SVGProps } from 'react'
import { FileTree as SharedFileTree, type TreeIcon } from '@localix-ai/flowdown'
import { fileIcon, folderIcon, type FileIconSpec } from './file-icon/fileIcon'

/** One glyph component per spec, kept: a new component on every render would remount the svg. */
const glyphs = new Map<FileIconSpec['Icon'], Map<string, TreeIcon>>()

function glyphFor({ Icon, color }: FileIconSpec): TreeIcon {
  let byColor = glyphs.get(Icon)
  if (!byColor) glyphs.set(Icon, (byColor = new Map()))
  let glyph = byColor.get(color)
  if (!glyph) {
    glyph = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
      <Icon {...props} className={color ? `${className ?? ''} ${color}` : className} />
    )
    byColor.set(color, glyph)
  }
  return glyph
}

/**
 * Workspace icons over the shared, keyboard-accessible Markdown tree. On a canvas board the tree is
 * a control, not a handle: `nodrag` keeps a press on it from moving the card, and a double click
 * that folds a branch does not also open the card for editing.
 */
export function FileTree({ source }: { source: string }) {
  return (
    <div className="nodrag" onDoubleClick={(event) => event.stopPropagation()}>
      <SharedFileTree
        source={source}
        getIcon={(row, open) => glyphFor(row.folder ? folderIcon(open) : fileIcon(row.name))}
      />
    </div>
  )
}
