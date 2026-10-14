/**
 * Does a path look like it holds a credential?
 *
 * By PATH, not by content — nothing here opens a file. A credential's location is the one
 * thing about it that is predictable (`.env`, `~/.ssh/id_rsa`, `~/.aws/credentials`), and a
 * glob over a path is exact in a way a glob over a shell line never is.
 *
 * Deliberately conservative. This is vocabulary a rule can name (`tool:read secrets ask`),
 * not a scanner: a false positive costs one confirmation, and a miss costs nothing that was
 * not already true before the class existed. Nothing carries a rule about it by default.
 *
 * It answers about the WHOLE path, so a project's own `config/credentials.example.yml` is
 * caught by the same rule that catches `~/.aws/credentials` — the two are told apart by
 * writing a narrower `allow` after it, which is what the rule grammar is for.
 */
const SECRET_PATH_PATTERNS = [
  // Dotenv, including per-environment variants: `.env`, `.env.local`, `.env.production`.
  /(^|\/)\.env(\.[^/]+)?$/,
  // SSH: the directory as a whole, because a private key has no fixed name.
  /(^|\/)\.ssh(\/|$)/,
  // Cloud and registry credential files, wherever the vendor puts them.
  /(^|\/)\.(?:aws|gcloud|azure|kube|docker|npm|cargo|gnupg)\/(?:credentials|config|.*\.json|.*rc)$/,
  // Anything whose own name says it: `credentials.json`, `secrets.yml`, `service-account.json`.
  /(^|\/)[^/]*(?:credential|secret|service-account)[^/]*$/i,
  // Private keys and certificates by extension, plus the conventional key names.
  /\.(?:pem|p12|pfx|key|keystore)$/i,
  /(^|\/)id_(?:rsa|dsa|ecdsa|ed25519)(\.pub)?$/,
  // The tokens a shell history or a CLI leaves lying around.
  /(^|\/)\.(?:netrc|pgpass|htpasswd)$/,
]

export function isSecretPath(path: string): boolean {
  return SECRET_PATH_PATTERNS.some((pattern) => pattern.test(path))
}
