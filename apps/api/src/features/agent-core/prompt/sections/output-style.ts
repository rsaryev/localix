/**
 * `# Output style` — the instructions of the output style the conversation runs in (Claude Code's
 * `/output-style`, a plugin's `output-styles/*.md`). A style sets the role, tone and format of every
 * reply, so it is stated as overriding the answer forms above it where the two disagree; it does
 * not override the person's own instructions or a safety rule. Chosen per conversation and changed
 * only between turns, so it sits in the cached prefix, after the answer formatting it refines.
 */
export function buildOutputStyleSection(style: { name: string; prompt: string }): string | null {
  const prompt = style.prompt.trim()
  if (!prompt) return null
  return [
    '# Output style',
    `This conversation uses the "${style.name}" output style. Follow it in every reply; where it differs from the answer formatting above, the style wins.`,
    '',
    prompt,
  ].join('\n')
}
