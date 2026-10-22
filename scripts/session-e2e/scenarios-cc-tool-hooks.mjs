/** Session E2E: Claude Code tool hooks: PreToolUse, PostToolUse, PostToolUseFailure, PermissionRequest, PermissionDenied, PostToolBatch. */
import { CC_TOOL_HOOK_INPUT_SCENARIOS } from './scenarios-cc-tool-hooks-inputs.mjs'
import { CC_TOOL_HOOK_DECISION_SCENARIOS } from './scenarios-cc-tool-hooks-decisions.mjs'
import { CC_TOOL_HOOK_POST_PERMISSION_SCENARIOS } from './scenarios-cc-tool-hooks-post-permission.mjs'

export const CC_TOOL_HOOK_SCENARIOS = [
  ...CC_TOOL_HOOK_INPUT_SCENARIOS,
  ...CC_TOOL_HOOK_DECISION_SCENARIOS,
  ...CC_TOOL_HOOK_POST_PERMISSION_SCENARIOS,
]
