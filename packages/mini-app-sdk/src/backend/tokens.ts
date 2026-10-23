/**
 * TOKEN ESTIMATION — the ~4-UTF-8-bytes-per-token budgeting heuristic, owned once.
 *
 * Three independent budget calculations in this app each open-coded
 * a cheap bytes/4 estimate: the edit-prediction context ranker, the Context Fabric
 * resource-context provider, and the Context Fabric generic resource resolver. They must
 * AGREE — they price contributions that compete for the same budget, so if one drifts to
 * `/3` the budgets silently disagree and the packer over- or under-fills with no error
 * anywhere. The constant is the knowledge; it gets one home.
 *
 * DELIBERATELY CHEAP AND PROVIDER-AGNOSTIC. This is not a tokenizer — it never calls one,
 * never allocates, and is wrong for any specific model. It is good enough to decide WHAT
 * to include and what to drop, which is the only question it is asked. (The exact divisor
 * matters far less than every caller using the same one.) Anything that must be EXACT — a hard context clamp, a billed token count — must
 * come from the provider, not from here.
 */

/** UTF-8 bytes per token. The single number all budget math in this app agrees on. */
const BYTES_PER_TOKEN = 4

/** Approximate token cost of a plain-text string. */
export function estimateTokens(text: string): number {
  return Math.ceil(Buffer.byteLength(text, 'utf8') / BYTES_PER_TOKEN)
}
