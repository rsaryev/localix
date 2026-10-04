// Inter Variable, inlined as a `data:` URI and registered at startup.
//
// Without this the font arrives as a separate local asset from `@fontsource-variable/inter`
// (`@import` in index.css, `font-display: swap`). Until it lands, text paints in
// the system fallback and then visibly re-renders in Inter — different metrics,
// so the UI "jumps" / the font appears to change by itself on first view.
//
// The bytes are embedded in the JS bundle (latin subset, ~tens of KB), so the
// face is available on the very first paint and the swap never happens. We inject
// it into <head> AFTER the linked stylesheet so that, for the latin range, this
// instantly-available face wins the cascade over fontsource's separate asset face.
//
// The sandboxed declarative tool-UI renderer embeds the same offline face.
import { interVariableFontDataUri } from '@/shared/theme/embeddedFonts'

const FONT_FACE_CSS = `@font-face{font-family:'Inter Variable';font-style:normal;font-display:block;font-weight:100 900;src:url("${interVariableFontDataUri}") format('woff2')}`

const style = document.createElement('style')
style.setAttribute('data-inline-font', 'inter')
style.textContent = FONT_FACE_CSS
document.head.appendChild(style)
