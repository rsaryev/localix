import type { KitCatalogEntry } from './types'

const k = (id: string) => `@localixai/kit/${id}`

/** Rows and collections: list rows, trees, key/value details, reordering, drop targets. */
export const LISTS: readonly KitCatalogEntry[] = [
  {
    specifier: k('workbench-list-row'),
    category: 'lists',
    provider: 'kit',
    exports: [
      'WorkbenchListRow',
      'WorkbenchListRowTrigger',
      'WorkbenchListRowLeading',
      'WorkbenchListRowText',
      'WorkbenchListRowMeta',
      'WorkbenchListRowActions',
    ],
    summary:
      'Sidebar and tree rows with sibling triggers, metadata and actions; hover actions can share their slot with passive metadata.',
    use: 'Every navigable row. `density` is `dense` 28px, `compact` 32px or `default` (40px min, with a description).',
    not: 'Not a row of hand-placed flex children with its own height; never a control nested inside the trigger.',
  },
  {
    specifier: k('tree-navigation'),
    category: 'lists',
    provider: 'kit',
    exports: ['indentGuideStyle', 'useTreeRovingFocus', 'treeNavKeyDown', 'useTreeTypeahead'],
    summary: 'Indent guides, roving focus, arrow keys and typeahead for a tree.',
    use: 'Any tree: files, schemas, request collections, layers. The indent comes from here.',
    not: 'Not `paddingLeft: depth * 12 + 8` written by hand.',
  },
  {
    specifier: k('overview-registry-row'),
    category: 'lists',
    provider: 'kit',
    exports: ['OverviewRegistryRow'],
    summary: 'A flat navigation row for overview screens.',
    use: "The entries of a mini app's overview or index page.",
  },
  {
    specifier: k('detail-field'),
    category: 'lists',
    provider: 'kit',
    exports: ['DetailField'],
    summary: 'One `label: value` row of a detail grid.',
    use: 'Inspecting a container, a pod, a record: fixed label column, truncating value.',
  },
  {
    specifier: k('divided-list'),
    category: 'lists',
    provider: 'kit',
    exports: ['DIVIDED_LIST'],
    summary: 'The class recipe for a list separated by hairlines.',
    use: 'Settings groups and detail lists drawn as rows with rules between them.',
  },
  {
    specifier: k('selected-row'),
    category: 'lists',
    provider: 'kit',
    exports: ['SELECTED_ROW', 'MENU_ROW'],
    summary: 'The accent recipe for the selected or keyboard-active row of a picker.',
    use: 'Highlighting the current option in custom pickers and lists.',
  },
  {
    specifier: k('list-reorder'),
    category: 'lists',
    provider: 'kit',
    exports: ['useListReorder', 'DragHandle', 'moveItem', 'computeDropIndex'],
    summary: 'Drag-to-reorder for a vertical list, with its handle.',
    use: 'Ordering items the user arranges (favourites, columns, steps).',
  },
  {
    specifier: k('drop-target'),
    category: 'lists',
    provider: 'kit',
    exports: ['DROP_TARGET_HINT', 'DROP_TARGET_INDICATOR', 'DROP_TARGET_FOCUS_GLOW'],
    summary: 'The visual vocabulary of a native drag-and-drop destination.',
    use: 'Feedback while something is dragged over a surface; the behaviour stays yours.',
  },
  {
    specifier: '@localixai/mini-app-sdk/ui/components',
    category: 'lists',
    provider: 'sdk',
    exports: ['TableGrid', 'FileTab', 'ProblemLine'],
    summary:
      'Host components lent through the SDK: the data grid, a file tab body, the problem line.',
    use: 'Tabular data (`TableGrid`: sortable, loads more at the end, optionally editable) instead of a raw <table>; a failed read shown as `ProblemLine`.',
    not: 'Not a raw <table> with a hand-made sort header.',
  },
]
