/**
 * Shared user-profile option catalogs — the single source of the role /
 * experience / use-case vocabularies for the General settings page, and for any
 * other surface that asks the same questions. Onboarding does NOT: profile is
 * not worth a mandatory first-run page, so it stays in Settings (see the
 * `ONBOARDING_STEPS` header for what earns a step).
 */
export const ROLE_OPTIONS = [
  { value: 'software-engineer', label: 'Software engineer' },
  { value: 'devops', label: 'DevOps / SRE' },
  { value: 'engineering-manager', label: 'Engineering manager' },
  { value: 'product-manager', label: 'Product manager' },
  { value: 'designer', label: 'Designer (UI/UX)' },
  { value: 'data-analyst', label: 'Data analyst / scientist' },
  { value: 'trader', label: 'Trader / quant' },
  { value: 'founder', label: 'Founder / operator' },
  { value: 'student', label: 'Student / learner' },
  { value: 'other', label: 'Other' },
]

export const EXPERIENCE_OPTIONS = [
  { value: 'beginner', label: 'Beginner (0–1 years)' },
  { value: 'junior', label: 'Junior (1–3 years)' },
  { value: 'mid', label: 'Mid-level (3–6 years)' },
  { value: 'senior', label: 'Senior (6+ years)' },
  { value: 'lead', label: 'Lead / Staff' },
]

export const USECASE_OPTIONS = [
  { value: 'build-products', label: 'Build products faster' },
  { value: 'write-code', label: 'Write and refactor code' },
  { value: 'research', label: 'Research and summarize topics' },
  { value: 'content', label: 'Draft content and documentation' },
  { value: 'data', label: 'Analyze data and reports' },
  { value: 'learning', label: 'Learn new tools and frameworks' },
]

/**
 * Quick-pick response-style presets for the "How should it respond?" field.
 * `phrase` is the natural-language fragment toggled into the free-text
 * `responsePreferences` value (comma-joined) — the field stays free text, so
 * users keep any custom wording alongside the chips. Onboarding + General
 * settings share this catalog.
 */
export const RESPONSE_STYLE_OPTIONS = [
  { value: 'concise', label: 'Concise', phrase: 'concise' },
  { value: 'code-first', label: 'Code first', phrase: 'code first' },
  { value: 'trade-offs', label: 'Explain trade-offs', phrase: 'explain trade-offs' },
  { value: 'step-by-step', label: 'Step by step', phrase: 'step by step' },
  { value: 'minimal-prose', label: 'Minimal prose', phrase: 'minimal prose' },
  { value: 'examples', label: 'Show examples', phrase: 'show examples' },
]

/** Comma-separated free text → trimmed, non-empty tokens. */
export const splitStyleTokens = (text: string | undefined): string[] =>
  (text ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)

/** Whether a style phrase is already present (case-insensitive) in the free text. */
export const hasStyleToken = (text: string | undefined, phrase: string): boolean =>
  splitStyleTokens(text).some((t) => t.toLowerCase() === phrase.toLowerCase())

/**
 * Toggle a style phrase in/out of the comma-joined free text, preserving any
 * custom tokens the user typed by hand. Returns the new field value.
 */
export const toggleStyleToken = (text: string | undefined, phrase: string): string => {
  const list = splitStyleTokens(text)
  const idx = list.findIndex((t) => t.toLowerCase() === phrase.toLowerCase())
  if (idx >= 0) list.splice(idx, 1)
  else list.push(phrase)
  return list.join(', ')
}
