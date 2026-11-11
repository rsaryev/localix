import { readMemoryRule } from '@rsaryev/llx-plugin/format'
import { ruleActivatesFor } from '@rsaryev/llx-plugin/skills'
import type { MemoryRuleReader } from '../../agent-core/context-rules'

/**
 * What a memory rule file means, the kit's (`readMemoryRule`: its `paths` and body, a block that
 * does not parse loading the rule with no `paths`) and which touched file activates it
 * (`ruleActivatesFor`, relative to `ruleBase`). agent-core reads it through its port.
 */
export const memoryRuleReader: MemoryRuleReader = {
  read: (path, text, scope) => readMemoryRule(path, text, scope).rule,
  activatesFor: (rule, file, cwd) => ruleActivatesFor(rule, file, cwd),
}
