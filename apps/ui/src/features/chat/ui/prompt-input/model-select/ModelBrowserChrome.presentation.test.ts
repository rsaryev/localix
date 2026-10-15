import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const readSource = (name: string) => readFileSync(new URL(`./${name}`, import.meta.url), 'utf8')

/** Every panel that can fill the model column, plus the side columns beside it. */
const MAIN_PANELS = [
  'ConnectionModelList.tsx',
  'CrossConnectionModelList.tsx',
  'ConnectionSettingsPanel.tsx',
  'AddConnectionForm.tsx',
]
const SIDE_COLUMNS = ['ModelTaskColumn.tsx', 'ModelSelectSidebar.tsx']

/**
 * The picker's geometry contract. The drawer used to drift on every axis — headers of 36px
 * beside a 28px override, four different left insets, a second divider at two heights — and the
 * defects were only visible side by side. These pin the shared measures where they are spelled.
 */
describe('model picker geometry', () => {
  test('every column header is the canonical 36px PanelHeader, never a height override', () => {
    for (const name of [...MAIN_PANELS, ...SIDE_COLUMNS, 'ModelDetailsSidePanel.tsx']) {
      const source = readSource(name)
      expect(source).toContain('<PanelHeader')
      expect(source).not.toContain('h-[var(--chrome-control-md)] border-b-0')
      expect(source).not.toContain('h-(--chrome-control-md) border-b-0')
    }
  })

  test('the second band is a default-density toolbar in the provider, model and details columns', () => {
    const bands = [
      readSource('ModelSelectSidebar.tsx'),
      readSource('ModelBrowserSearchToolbar.tsx'),
      readSource('ModelDetailPanel.tsx'),
    ]
    for (const source of bands) {
      const toolbar = source.slice(source.indexOf('<WorkbenchToolbar'))
      expect(toolbar.slice(0, toolbar.indexOf('>'))).not.toContain('density=')
    }
    // The model id no longer sits under the name, where it pushed the details divider a line down.
    const detail = readSource('ModelDetailPanel.tsx')
    // …and the name band keeps its seam: `border-b-0` there erased the container's divider too.
    const nameBand = detail.slice(detail.indexOf('aria-label="Model"'))
    expect(nameBand.slice(0, nameBand.indexOf('>'))).not.toContain('border-b-0')
    expect(detail.indexOf("'Model ID'")).toBeGreaterThan(detail.indexOf('<WorkbenchToolbar'))
  })

  test('rows and list bodies take the one shared inset', () => {
    for (const name of [
      'ModelSelectSidebar.tsx',
      'ModelTaskColumn.tsx',
      ...MAIN_PANELS.slice(0, 2),
    ]) {
      expect(readSource(name)).toContain('PICKER_LIST')
    }
    expect(readSource('ModelSelectSidebar.tsx')).toContain('pickerRow(')
    expect(readSource('ModelBrowser.tsx')).toContain('<ResetRouteRow')
    expect(readSource('ModelBrowserParts.tsx')).toContain('pickerRow(')
    const row = readSource('ModelListItem.tsx')
    expect(row).toContain('px-1.5')
    expect(row).toContain('min-h-(--chrome-control-lg)')
  })

  test('side columns are columns or sheets, never a squeezed horizontal strip', () => {
    for (const name of SIDE_COLUMNS) {
      const source = readSource(name)
      expect(source).toContain('pickerColumnFrame(layout')
      expect(source).not.toContain('max-sm:')
      expect(source).not.toContain('max-md:flex-row')
    }
    // One builder draws each column in both places, so a sheet cannot drift from its column.
    const columns = readSource('pickerColumns.tsx')
    expect(columns).toContain("taskColumnFor('sheet'")
    expect(columns).toContain("providerColumnFor('sheet'")
    expect(readSource('ModelBrowser.tsx')).toContain("taskColumnFor('column')")
    for (const name of MAIN_PANELS) expect(readSource(name)).toContain('PickerPanelTitle')
  })

  test('the reasoning level is set in the details panel, with nothing floating over the list', () => {
    for (const name of ['ModelBrowser.tsx', 'ModelListItem.tsx', 'ModelDetailsSidePanel.tsx']) {
      expect(readSource(name)).not.toContain('ModelReasoningControl')
    }
    // The app's shared menu, not a bespoke popover or a strip of truncating segments.
    const menu = readSource('ModelReasoningMenu.tsx')
    expect(menu).toContain('<MenuEntries')
    expect(menu).toContain('<DropdownMenu>')
    expect(readSource('ModelDetailSettings.tsx')).toContain('<ModelReasoningMenu')
    expect(readSource('ModelBrowser.tsx')).toContain('settings={modelSettings}')
  })

  test('provider search and model search are separate fields', () => {
    const browser = readSource('ModelBrowser.tsx')
    expect(browser).toContain('deferredSearch: deferredProviderSearch')
    expect(readSource('ModelSelectSidebar.tsx')).toContain('placeholder="Search providers…"')
    expect(readSource('ModelBrowserSearchToolbar.tsx')).not.toContain('Search providers')
  })
})
