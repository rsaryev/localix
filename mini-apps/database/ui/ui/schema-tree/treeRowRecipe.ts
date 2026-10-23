import type { CSSProperties } from 'react'
import { indentGuideStyle } from '@localixai/kit/tree-navigation'

/**
 * ONE geometry for every schema-tree row — connection, schema, group, table, column, index.
 *
 * The defect it stops: each row kind carried its own height and indent (connection 24px at 8px,
 * schema at a literal 20px, group at 32px, table 28px at `depth*12+8`, columns and indexes
 * `py-0.5` inside a padded wrapper so their hover band stopped short of the tree's left edge), and
 * an expanded table was painted `bg-surface-hover` so "open" looked like "hovered". The host Files
 * tree is `h-6`, `depth*12+8`, indent guides, and `bg-surface-active` for the selected row; this is
 * that recipe, applied to every kind, with the hover band always the full row width.
 */
export const TREE_ROW =
  'group flex h-6 w-full min-w-0 cursor-default select-none items-center gap-1.5 pr-2 text-left text-xs outline-none transition-colors focus-ring'

export const TREE_ROW_IDLE = 'text-text-soft hover:bg-surface-hover hover:text-foreground'
export const TREE_ROW_SELECTED = 'bg-surface-active text-foreground'

/** The chevron slot a leaf row leaves empty so its glyph lines up under its parent's. */
const LEAF_OFFSET = 16

export function treeRowStyle(depth: number, leaf = false): CSSProperties {
  return { paddingLeft: depth * 12 + 8 + (leaf ? LEAF_OFFSET : 0), ...indentGuideStyle(depth) }
}

export const TREE_CHEVRON = 'size-3.5 shrink-0 text-text-faint transition-transform'
export const TREE_GLYPH = 'size-3.5 shrink-0 text-text-faint'
/** Column/index glyphs: one step smaller than an object's, still one size for all of them. */
export const TREE_LEAF_GLYPH = 'size-3 shrink-0'
