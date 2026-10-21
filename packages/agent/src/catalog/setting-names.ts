/**
 * WHICH PROVIDER VARIABLES ARE SECRETS. models.dev lists every variable a provider reads; a secret
 * belongs in the connection's key, which is encrypted and never shown back, while any other is a
 * setting stored and shown beside it. The engine (what a connection is asked for) and the API (what
 * it accepts) share this one test, so a token can never slip through as a plain-text setting.
 */

/** Read as a secret wherever it appears in the name (`OPENAI_API_KEY`, `AWS_SESSION_TOKEN`). */
const SECRET_PART = /KEY|SECRET|TOKEN|CREDENTIAL|PASSW/i
/** Read as a secret as a whole word of the name (`CLARIFAI_PAT`, `X_AUTH`, `PRIVATE_PEM`). */
const SECRET_WORDS = new Set([
  'PAT',
  'AUTH',
  'BEARER',
  'PRIVATE',
  'COOKIE',
  'SESSION',
  'JWT',
  'PASS',
])

export function isSecretSettingName(name: string): boolean {
  return (
    SECRET_PART.test(name) ||
    name
      .toUpperCase()
      .split('_')
      .some((word) => SECRET_WORDS.has(word))
  )
}
