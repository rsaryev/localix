/**
 * The numbers and small rules of mods as the kit holds them (plugins/mods/reference.md, "Limits"
 * and "Mods API methods"): every limit of a `$` call, an event or a tree, the 64-character name
 * rule of a command, tool, subagent type or pane, and the `{ window, tokens, percent }` of the
 * context window that `$.session.usage()` and `session.measure` carry; a hook's reason cut at 4,096
 * characters, the line a person reads of a prompt a hook dropped, and what the model reads of a
 * tool call whose result a hook withheld, and the reply to a mod's `/command` no hook answered.
 */
export {
  clampReason,
  contextUsage,
  MOD_LIMITS,
  nameProblem as modNameProblem,
  promptDroppedText,
  unansweredCommandReply,
  withheldResultText,
  type ToolCallEnd,
} from '@rsaryev/llx-plugin/mods'
