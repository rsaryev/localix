/** Encode a buffer as URL-safe base64 (RFC 4648 §5: +→-, /→_, no `=` padding).
 *  Used for PKCE verifiers/challenges and other OAuth values. */
export function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
