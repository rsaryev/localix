import {
  Box,
  Braces,
  FileCode2,
  Folder,
  ListOrdered,
  Package,
  SquareFunction,
  Type,
  Variable,
  type LucideIcon,
} from 'lucide-react'
import type { EdgeKind, NodeKind } from '../shared/model'

/** One icon and one word per kind, everywhere the view names a node. */
export const KIND_ICON: Record<NodeKind, LucideIcon> = {
  directory: Folder,
  file: FileCode2,
  class: Box,
  interface: Braces,
  type: Type,
  enum: ListOrdered,
  function: SquareFunction,
  method: SquareFunction,
  variable: Variable,
  package: Package,
}

export const KIND_LABEL: Record<NodeKind, string> = {
  directory: 'Directory',
  file: 'File',
  class: 'Class',
  interface: 'Interface',
  type: 'Type',
  enum: 'Enum',
  function: 'Function',
  method: 'Method',
  variable: 'Variable',
  package: 'Package',
}

export const EDGE_LABEL: Record<EdgeKind, { out: string; in: string; filter: string }> = {
  imports: { out: 'Imports', in: 'Imported by', filter: 'Imports' },
  calls: { out: 'Calls', in: 'Called by', filter: 'Calls' },
  extends: { out: 'Extends', in: 'Extended by', filter: 'Inheritance' },
  implements: { out: 'Implements', in: 'Implemented by', filter: 'Implements' },
}

/**
 * A quiet hue per kind, on the icon only: enough to tell a class from a function at a glance,
 * never enough to turn the map into a legend to learn. Chart tokens follow the theme.
 */
export const KIND_TINT: Record<NodeKind, string> = {
  directory: 'text-text-soft',
  file: 'text-(--chart-1)',
  class: 'text-(--chart-2)',
  interface: 'text-(--chart-3)',
  type: 'text-(--chart-5)',
  enum: 'text-(--chart-5)',
  function: 'text-(--chart-4)',
  method: 'text-(--chart-4)',
  variable: 'text-(--chart-6)',
  package: 'text-text-faint',
}

/** A node can be opened as a level of its own: a directory, or a file to see its symbols. */
export const canOpen = (kind: NodeKind) => kind === 'directory' || kind === 'file'
