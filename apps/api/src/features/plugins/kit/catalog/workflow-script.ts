import { readScriptHead } from '@rsaryev/llx-plugin/agents'

/**
 * A workflow script split as the kit reads it (`readScriptHead`; workflows.md, "What the saved
 * script looks like"): its `meta` name and description and the body after the `meta` statement,
 * or why its `meta` cannot be read. The script never runs here.
 */
export type WorkflowScript =
  | { readonly name: string; readonly description: string; readonly body: string }
  | { readonly error: string }

export function workflowScript(source: string): WorkflowScript {
  const head = readScriptHead(source, 'head')
  if (!head.meta)
    return {
      error:
        head.issues.map((issue) => issue.message).join('; ') ||
        '`export const meta = {…}` must be the first statement',
    }
  const { name, description } = head.meta
  return { name, description, body: source.slice(head.headEnd) }
}
