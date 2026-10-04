// One build-owned, offline font payload shared by the host's first-paint guard
// and sandboxed tool UIs. Keeping the raw asset import here prevents two surfaces
// from developing different font sources or accidentally introducing a CDN.
import interVariableFontDataUri from '@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?inline'

export { interVariableFontDataUri }
