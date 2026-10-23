/**
 * The host lends its components to mini apps lazily. A suite that asserts on one — the grid, the
 * problem line — warms them first, or its first render races a cold module load and the assertion
 * meets nothing. Call it AFTER `registerDom`: the modules pull in Radix, which fixes its portal
 * behaviour when it is first evaluated, and evaluated without a document every dialog renders empty.
 *
 * Its own entry, not the kit's testing index: the lent components reach the code editor, and every
 * mini app test that imports the index would otherwise type-check the host's whole editor graph.
 */
export { preloadMiniAppUiComponents as warmMiniAppUiComponents } from '@/app/miniAppUiComponents'
