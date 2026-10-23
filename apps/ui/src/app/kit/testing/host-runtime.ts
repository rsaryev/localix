// Side effect: bind the mini app SDK to the real host runtime (transport, components, buses), as
// the workbench does at boot. Import it FIRST in a mini app test that drives host integrations.
import '@/app/miniAppRuntime'
