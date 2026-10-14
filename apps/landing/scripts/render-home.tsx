import { renderToString } from 'react-dom/server'
import { StaticRouter } from 'react-router'
import { AppRoutes } from '../src/app/AppRoutes'

/**
 * The homepage as HTML, rendered from the same route table the browser mounts.
 *
 * It used to be a hand-written lookalike (headline, buttons, a play-button box) that React then
 * replaced. The two never had the same fonts, heights or positions, so the page painted one
 * layout and jumped to another a moment later: that jump was the flash on load. Rendering the real
 * tree means the first paint already is the page, and `hydrateRoot` adopts it without a repaint.
 */
export function renderHomeMarkup(): string {
  return renderToString(
    <StaticRouter location="/">
      <AppRoutes />
    </StaticRouter>,
  )
}
