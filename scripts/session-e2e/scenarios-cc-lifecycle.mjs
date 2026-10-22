/** Session E2E: Plugin lifecycle over /rpc: install, enable, disable, remove, update, validate, details, marketplaces. */
import { CC_LIFECYCLE_INSTALL_SCENARIOS } from './scenarios-cc-lifecycle-install.mjs'
import { CC_LIFECYCLE_MARKETPLACE_SCENARIOS } from './scenarios-cc-lifecycle-marketplace.mjs'
import { CC_LIFECYCLE_OPTION_SCENARIOS } from './scenarios-cc-lifecycle-options.mjs'
import { CC_LIFECYCLE_SCOPE_SCENARIOS } from './scenarios-cc-lifecycle-scopes.mjs'

// Docs: https://code.claude.com/docs/en/plugins/{cli-reference,manifest-reference,
// marketplace-reference,dependencies,install,loading}.md and /docs/en/plugins-reference.md —
// each assertion quotes its line. `/plugin install <path>`, `/plugin update` and `/plugin details`
// have no session form in Claude Code ("The shell subcommands init, update, details … have no
// session form"); Localix offers them, and the scenarios use them as fixtures or hold them to the
// documented `claude plugin` CLI behaviour.

export const CC_LIFECYCLE_SCENARIOS = [
  ...CC_LIFECYCLE_INSTALL_SCENARIOS,
  ...CC_LIFECYCLE_MARKETPLACE_SCENARIOS,
  ...CC_LIFECYCLE_OPTION_SCENARIOS,
  ...CC_LIFECYCLE_SCOPE_SCENARIOS,
]
