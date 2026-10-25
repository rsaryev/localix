/**
 * Claude Code's WebSearch (`query`, `allowed_domains`, `blocked_domains`) and WebFetch (`url`,
 * `prompt`) arguments, as `research` takes them: both tools are the one composite here.
 *
 * `question` is what the evidence must answer: WebSearch's `query`, WebFetch's `prompt` (the
 * page's own address when there is none). `url` is a known source to read. A Claude Code field
 * that disagrees with the native one beside it is refused: the call would otherwise run the one
 * the tool happens to prefer.
 */
const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

export function prepareResearchArguments(raw: unknown): unknown {
  if (!isRecord(raw)) return raw
  const claudeKeys = ['query', 'prompt', 'url', 'allowed_domains', 'blocked_domains']
  if (!claudeKeys.some((key) => raw[key] !== undefined)) return raw
  const { query, prompt, url, allowed_domains, blocked_domains, ...rest } = raw
  const out: Record<string, unknown> = { ...rest }

  const alias = (claude: string, value: unknown, native: string) => {
    if (value === undefined) return
    if (out[native] !== undefined && !same(out[native], value))
      throw new Error(`research got both \`${claude}\` and a different \`${native}\`: pass one.`)
    out[native] = value
  }
  alias('query', query, 'question')
  alias('prompt', prompt, 'question')
  alias('allowed_domains', allowed_domains, 'include_domains')
  alias('blocked_domains', blocked_domains, 'exclude_domains')
  if (query !== undefined && prompt !== undefined && !same(query, prompt))
    throw new Error('research got both `query` and a different `prompt`: pass one.')

  if (typeof url === 'string') {
    const urls = Array.isArray(out.urls) ? (out.urls as unknown[]) : []
    out.urls = [url, ...urls.filter((known) => known !== url)]
    if (out.question === undefined) out.question = url
  }
  return out
}
