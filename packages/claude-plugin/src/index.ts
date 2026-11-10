/**
 * What Localix keeps of the Claude Code plugin format beside the kit (`@rsaryev/llx-plugin`, which
 * reads plugins): where the manifest lives, the shapes of output styles and themes, workflow meta.
 * A host composes this with its own concepts; nothing here knows of one.
 */
export { COMPONENT_MARKERS, MANIFEST_DIR, MANIFEST_FILE, MARKETPLACE_FILE } from './layout'
export { DEFAULT_OUTPUT_STYLE, outputStyleOf, type OutputStyle } from './output-style'
export type { ClaudeTheme, ThemeBase } from './theme'
export { parseWorkflowMeta, type WorkflowMeta, type WorkflowMetaResult } from './workflow-meta'
