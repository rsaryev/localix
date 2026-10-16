// Side effect: bind the plugin SDK to the real host runtime (transport, components, buses), as
// the workbench does at boot. Import it FIRST in a plugin test that drives host integrations.
import '@/app/pluginRuntime'
