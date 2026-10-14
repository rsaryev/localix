/**
 * Make text safe to place in HTML element content or a quoted attribute.
 *
 * One copy for the server's hand-written pages (the OAuth callbacks in `app.ts` and
 * `features/mcp/routes.ts`). Those pages are served from the API's own origin, so an
 * unescaped error message that echoes provider- or attacker-supplied text is script running
 * with the right to call every route — the OAuth failure page interpolated it raw.
 */
export function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"']/gu,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch,
  )
}
