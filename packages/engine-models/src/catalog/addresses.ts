/**
 * WHERE A KEY MAY GO. models.dev decides the address each provider's key is sent to, so one bad
 * entry (a merged pull request, a compromised CDN) would redirect every user's key at the next
 * refresh. Checked once per document:
 * - a first-party provider's key goes only to its own host, whatever the document says;
 * - a model's own address stays on its provider's origin, or inside its cloud when the provider
 *   has no address of its own (Claude on Azure, OpenAI models on Bedrock);
 * - every address is https, except one on this computer.
 */

/** First-party providers and the one origin their requests may reach. */
export const PINNED_ADDRESS: Readonly<Record<string, string>> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  google: 'https://generativelanguage.googleapis.com/v1beta',
  openrouter: 'https://openrouter.ai/api/v1',
  'github-copilot': 'https://api.githubcopilot.com',
  vercel: 'https://ai-gateway.vercel.sh/v4/ai',
}

/** Where a model may live when its provider names no address: inside the provider's cloud. */
const CLOUD_HOSTS = ['.amazonaws.com', '.api.aws', '.azure.com']
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]'])

/** The address as a URL, its variables standing in as a placeholder label; undefined when unreadable. */
function parse(address: string): URL | undefined {
  try {
    return new URL(address.replace(/\$\{[A-Z0-9_]+\}/g, 'x'))
  } catch {
    return undefined
  }
}

/** What two addresses must share to be one origin: a leading variable, or the URL's origin. */
function originKey(address: string): string | undefined {
  const leading = /^\$\{[A-Z0-9_]+\}/.exec(address)
  return leading ? leading[0] : parse(address)?.origin
}

/** https, or http to this computer; an address that starts with a variable is checked when filled. */
function secure(address: string): boolean {
  if (/^\$\{[A-Z0-9_]+\}/.test(address)) return true
  const url = parse(address)
  if (!url || url.username || url.password) return false
  return url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK.has(url.hostname))
}

/**
 * The provider's own address as far as it can be trusted: a first-party provider's stays on its
 * pinned origin (an address elsewhere is replaced by the pinned one; none stays none, and the
 * SDK's own default is then sent explicitly); any other must be secure. `null` refuses the
 * provider altogether.
 */
export function providerAddress(id: string, api: string | undefined): string | undefined | null {
  const pinned = PINNED_ADDRESS[id]
  if (api === undefined) return undefined
  if (pinned) return originKey(api) === originKey(pinned) ? api : pinned
  return secure(api) ? api : null
}

/** Whether a model's own address may carry its provider's key. */
export function modelAddressAllowed(
  providerId: string,
  providerApi: string | undefined,
  modelApi: string,
): boolean {
  if (!secure(modelApi)) return false
  const anchor = PINNED_ADDRESS[providerId] ?? providerApi
  if (anchor) return originKey(modelApi) === originKey(anchor)
  const host = parse(modelApi)?.hostname
  return host !== undefined && CLOUD_HOSTS.some((suffix) => host.endsWith(suffix))
}
