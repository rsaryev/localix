import {
  ANSWER_FORM_EXAMPLES,
  CALLOUT_KINDS,
  DIAGRAM_FENCE_LANGUAGE,
  DIAGRAM_KINDS,
  TREE_FENCE_LANGUAGE,
} from './answer-markdown'
import type { RunShape } from '@localixai/agent/agents'

/**
 * `# Answer formatting` — how a reply the person reads in the transcript should be shaped.
 *
 * The defect it stops: the prompt said nothing about form beyond link syntax, so an answer's
 * shape was whatever the model defaulted to — headings on a two-line reply, parallel bullet
 * lists where a table belonged, a warning buried mid-paragraph — and the renderer's callouts
 * and diagrams went unused because nothing told the model they existed.
 *
 * Every construct named here is read from `answer-markdown.ts`, the leaf the UI renderer
 * imports too, so the prompt cannot advertise a marker the transcript would print as raw text.
 *
 * Rendered only where that renderer is what the reader sees: a CHAT shape (a sub-agent's report
 * is read by its parent model, an automation's result is a summary record) with no delivery
 * channel (a relayed reply lands in another app, which draws neither callouts nor diagrams).
 * Session-stable, so it sits in the cached prefix.
 */
export const ANSWER_FORMAT_HEADER = '# Answer formatting'

export function rendersAnswerMarkdown(shape: RunShape, deliveryChannel: string | undefined) {
  return shape === 'chat' && !deliveryChannel
}

/** An example under its rule line, two spaces in, blank lines kept blank. */
const shown = (lines: readonly string[]) =>
  lines.map((line) => (line ? `  ${line}` : '')).join('\n')

/**
 * The one line `# Core principles` carries for a rendered chat. The defect it stops: with every
 * form described only in this section, mid-prompt, a model (GPT-6.1 in a live session) still
 * answered "plan by day" with a numbered list, "worth it?" with prose and "key figures" with a
 * table — the section read as an optional reference. Stated among the rules that lead the prompt,
 * the forms are part of answering; the forms themselves stay here, where they are shown.
 */
export const ANSWER_FORMS_PRINCIPLE = `- Shape every reply with the forms in "${ANSWER_FORMAT_HEADER.slice(2)}": the app renders them, and a plain list or table where a form fits is a formatting defect.`

export function buildAnswerFormatSection(): string {
  // Every character here rides every chat request's prefix (`system-prompt.test.ts` holds the
  // budget), so a rule is one line; the forms the model cannot know are SHOWN under their rule,
  // and the ones it already writes (a callout, a tree, a task item) name their syntax inline.
  const markers = CALLOUT_KINDS.map((kind) => `[!${kind.toUpperCase()}]`).join(' ')
  const { comparison, verdict, steps, stats } = ANSWER_FORM_EXAMPLES
  return [
    ANSWER_FORMAT_HEADER,
    "Replies render as GitHub Markdown with $…$ math plus the forms below; the user's style preferences override them.",
    // A DECISION list, read top-down: the old rules were a catalogue, and "compare options … in a
    // table" was the only one a "compare X and Y" request matched, so every comparison became a
    // table. Ordered so the first match wins, with the table and the plain list as the fallback.
    'Match the content to the first form that fits; a table or list is the fallback. Write a marker as its own quote line, the content unquoted after it.',
    '- Lead with the answer. Short replies use prose; long ones use `##` per thread, short paragraphs and selective bold.',
    `- Options compared (X vs Y, which to use) or variants (per OS, language): a tab per option, \`#### Label\`; a compared option holds its sides. Then one line on when to pick which:\n${shown(comparison)}`,
    `- One option weighed (should I, is it worth it): its sides, then the verdict:\n${shown(verdict)}`,
    `- Stages in order (a plan, recovery, schedule, by day, a procedure): steps, never a numbered list:\n${shown(steps)}`,
    `- Headline figures (speedups, sizes, key numbers): stats:\n${shown(stats)}`,
    '- Exact values across options (specs, prices, limits): a table.',
    `- A risk or key aside: one or two callouts, quotes starting \`> [!KIND]\` (${markers}); text after the marker titles it.`,
    `- A directory layout: a \`\`\`${TREE_FENCE_LANGUAGE} fence of \`├──\`/\`└──\` lines. Things to do: \`- [ ] item\` (the reader ticks them).`,
    `- Draw what a picture explains better in a \`\`\`${DIAGRAM_FENCE_LANGUAGE} fence (${DIAGRAM_KINDS.join(', ')}); quote labels with punctuation.`,
    '- Draw proactively for branching flows, structure and data; prefer one useful picture over ASCII art. Use supplied data; label illustrative data. Never claim an unsupported chart type.',
    '- Diagram controls: enlarge, pan/zoom, source/copy and enabled plugin destinations.',
    '- Quote attribution: `> — Author`. Image caption: `![alt](url "Caption")`.',
  ].join('\n')
}
