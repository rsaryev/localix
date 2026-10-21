import type { KitCatalogEntry } from './types'

const k = (id: string) => `@localixai/kit/${id}`

/** Class recipes, motion, platform reads and small helpers the primitives are built from. */
export const FOUNDATION: readonly KitCatalogEntry[] = [
  {
    specifier: k('popover-surface'),
    category: 'recipes',
    provider: 'kit',
    exports: ['POPOVER_SURFACE', 'POPOVER_MATERIAL', 'POPOVER_SURFACE_OVER_FOREIGN'],
    summary:
      'The floating material, and its panel cut; the opaque cut for panels over foreign pages.',
    use: "A custom floating panel that must look like the kit's popovers. The strip cut is `FLOATING_SURFACE` from the workbench-toolbar module.",
    not: 'Never transcribe the material (fill, blur, shadow, rim) by hand.',
  },
  {
    specifier: k('collapsible-motion'),
    category: 'recipes',
    provider: 'kit',
    exports: ['COLLAPSIBLE_MOTION'],
    summary: 'One motion recipe for a disclosure: header, chevron and grid-rows body.',
    use: 'A custom expand/collapse, so the chevron and the body settle together.',
  },
  {
    specifier: k('chrome-action'),
    category: 'recipes',
    provider: 'kit',
    exports: ['chromeAction', 'chromeActionActive'],
    summary: "The compact action of the app's own titlebar and header chrome.",
    use: 'Host chrome only.',
    not: 'Plugins do not use it (`scripts/plugin-chrome-recipes.test.ts`): a plugin action is IconButton.',
  },
  {
    specifier: k('rail-button'),
    category: 'recipes',
    provider: 'kit',
    exports: ['railBtn', 'railBtnActive', 'statusBtnActive'],
    summary: 'The navigation rail button recipe.',
    use: 'The workspace rail only.',
  },
  {
    specifier: k('environment'),
    category: 'foundation',
    provider: 'kit',
    exports: ['isDesktop', 'OS_FAMILY', 'hasNativeWindowMaterial', 'prefersReducedMotion'],
    summary: 'Feature-detection reads: desktop shell, OS family, glass material, reduced motion.',
    use: 'Branching on the platform or the motion preference.',
    not: 'Not a read of the browser `navigator` or a media query of your own.',
  },
  {
    specifier: k('lib'),
    category: 'foundation',
    provider: 'kit',
    exports: [
      'createBoundedCache',
      'loadOnce',
      'fuzzyMatchPositions',
      'useElementWidth',
      'useHorizontalWheelScroll',
      'dismiss',
      'isDismissed',
    ],
    summary:
      'Small helpers the primitives share: a bounded cache, once-loading, fuzzy match, element width, a mouse wheel that scrolls a one-line row sideways, one-shot dismissal.',
    use: 'The same needs in a surface, instead of a private copy.',
  },
  // Served by the host.
  {
    specifier: k('platform'),
    category: 'foundation',
    provider: 'host',
    exports: ['platformCapabilities', 'prefersReducedMotion'],
    summary: 'What the host can do here: open externally, reveal in the file manager, copy.',
    use: 'An action that needs the desktop shell.',
  },
  {
    specifier: k('theme'),
    category: 'foundation',
    provider: 'host',
    exports: ['useTheme'],
    summary: 'The resolved theme (light or dark) and the material in use.',
    use: 'A surface that draws with a library needing explicit colours (a chart engine, a canvas).',
    not: 'Styling needs no theme read: tokens follow the theme by themselves.',
  },
  {
    specifier: k('user-settings'),
    category: 'foundation',
    provider: 'host',
    exports: ['useUserSettings'],
    summary: "The user's settings, read-only. Recorded debt: host feature state.",
    use: 'Only where a plugin must follow a user preference the host owns.',
  },
  {
    specifier: '@localixai/plugin-sdk/ui/classes',
    category: 'recipes',
    provider: 'sdk',
    exports: [
      'cn',
      'FIELD_SURFACE',
      'CONTROL_INVALID',
      'CONTROL_FOCUS_VISIBLE',
      'CONTROL_FOCUS_WITHIN',
    ],
    summary: '`cn()` and the field, invalid and focus recipes every control carries.',
    use: 'Composing classes, and building a custom control that must look like a field.',
  },
]
