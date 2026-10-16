/**
 * Secret redaction for the MODEL-facing bash output.
 *
 * A credential printed by `env`, `cat .env`, a failing curl, or a stack trace
 * otherwise lands verbatim in the prompt and is re-sent every turn until a
 * context checkpoint masks it — and stays in the transcript after that. HIGH-CONFIDENCE, vendor-anchored patterns only — no entropy
 * heuristics, no generic hex: a false positive corrupts legitimate output
 * (a git SHA, a base64 blob, a UUID must survive untouched), and the model
 * acting on a corrupted value is worse than the token cost of a leak-shaped
 * string. The first 4 chars are kept so the model can still IDENTIFY which
 * credential a program printed ("your AKIA… key is invalid") without ever
 * seeing it.
 */

interface SecretPattern {
  kind: string
  // Every regex is anchored on a vendor-fixed prefix or an explicit
  // assignment/header context — never on shape alone.
  re: RegExp
}

const PATTERNS: SecretPattern[] = [
  // AWS access key id: fixed AKIA prefix + exactly 16 uppercase alnum.
  { kind: 'aws-key', re: /\bAKIA[0-9A-Z]{16}\b/g },
  // GitHub fine-grained PAT — before the classic form so `github_pat_` is
  // labeled whole rather than partially matched.
  { kind: 'github-token', re: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g },
  // GitHub classic/OAuth/app tokens: ghp_/gho_/ghu_/ghs_/ghr_ + 36+ alnum.
  { kind: 'github-token', re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g },
  // Anthropic before OpenAI: `sk-ant-…` must never be labeled openai-key.
  { kind: 'anthropic-key', re: /\bsk-ant-[A-Za-z0-9-]{20,}/g },
  // OpenAI, guarded against short `sk-…` false positives: either the
  // unambiguous project prefix, or a 40+ char alnum tail.
  { kind: 'openai-key', re: /\bsk-proj-[A-Za-z0-9_-]{20,}/g },
  { kind: 'openai-key', re: /\bsk-[A-Za-z0-9]{40,}\b/g },
  // Slack: bot/user/app/legacy/refresh token families.
  { kind: 'slack-token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
]

// AWS secret keys have no vendor prefix (40 base64-ish chars), so shape alone
// is a false-positive machine — require an explicit assignment context.
const AWS_SECRET = /\b(aws_secret_access_key\b\s*[:=]\s*["']?)([A-Za-z0-9/+=]{40})\b/gi

// `Authorization: Bearer <token>` — the header context makes a long opaque
// token unambiguous where the same string alone would not be.
const BEARER = /\b(Bearer\s+)([A-Za-z0-9._~+/=-]{40,})/g

// PEM private-key blocks (RSA/EC/OPENSSH/PKCS8/encrypted): redacted WHOLE —
// header through footer — because the body alone is enough to reconstruct
// the key. No 4-char prefix here: the header IS the identification.
const PEM = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g

/**
 * `AKIAIOSFODNN7EXAMPLE` → `AKIA…[REDACTED:aws-key]`. The kept prefix is too
 * short to narrow a brute-force search but long enough to tell WHICH of two
 * printed keys an error message refers to. Idempotent: `…[REDACTED:` can
 * never re-satisfy a pattern's fixed-prefix + charset requirement.
 */
function mark(secret: string, kind: string): string {
  return `${secret.slice(0, 4)}…[REDACTED:${kind}]`
}

export function redactSecrets(text: string): string {
  let out = text.replace(PEM, '[REDACTED:private-key]')
  for (const { kind, re } of PATTERNS) {
    out = out.replace(re, (m) => mark(m, kind))
  }
  out = out.replace(
    AWS_SECRET,
    (_, ctx: string, secret: string) => ctx + mark(secret, 'aws-secret'),
  )
  out = out.replace(BEARER, (_, ctx: string, secret: string) => ctx + mark(secret, 'bearer-token'))
  return out
}
