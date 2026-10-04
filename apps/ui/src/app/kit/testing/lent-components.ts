/**
 * The host lends its components to plugins lazily. A suite that asserts on one — the grid, the
 * problem line — warms them first, or its first render races a cold module load and the assertion
 * meets nothing. Call it AFTER `registerDom`: the modules pull in Radix, which fixes its portal
 * behaviour when it is first evaluated, and evaluated without a document every dialog renders empty.
 *
 * Its own entry, not the kit's testing index: the lent components reach the code editor, and every
 * plugin test that imports the index would otherwise type-check the host's whole editor graph.
 */
export { preloadPluginUiComponents as warmPluginUiComponents } from '@/app/pluginUiComponents'
