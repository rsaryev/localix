/**
 * Tool names older transcripts carry that the catalog no longer has, mapped to the tool that does
 * the same work now — so a stored call keeps its card and label instead of falling back to the
 * generic one. Presentation only: nothing here can call a tool.
 */
const LEGACY_TOOL_NAMES: Readonly<Record<string, string>> = {
  // Its reads became modes of `global_search` (around_message_id, session_id, browse).
  history_search: 'global_search',
}

export const currentToolName = (name: string): string => LEGACY_TOOL_NAMES[name] ?? name
