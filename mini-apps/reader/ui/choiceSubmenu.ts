import type { IconComponent, MenuSubmenuEntry } from '@localixai/mini-app-sdk/ui'

/** One option of a reader pick, as every menu that offers it draws it. */
export interface ReaderMenuChoice<T> {
  value: T
  label: string
  description?: string
  icon?: IconComponent
}

/**
 * One dimension of a reader setting as a submenu row: its current pick as the row's `hint`, its
 * options as `selected` rows that keep the menu open.
 *
 * The defect it stops: the reader drew each setting as its own segmented row inside a popover (the
 * appearance panel held eight), and its menus marked a pick with Radix radio items — two shapes
 * for one gesture, neither the app's menu. Built once here, every reader pick reads like the
 * composer's mode menu: choosing steps back to the parent level, where the hint shows the answer.
 */
export function choiceSubmenu<T>({
  id,
  label,
  icon,
  current,
  choices,
  onPick,
}: {
  id: string
  label: string
  icon?: IconComponent
  current: T
  choices: readonly ReaderMenuChoice<T>[]
  onPick: (value: T) => void
}): MenuSubmenuEntry {
  return {
    id,
    label,
    icon,
    hint: choices.find((choice) => choice.value === current)?.label,
    items: choices.map((choice) => ({
      id: `${id}:${String(choice.value)}`,
      label: choice.label,
      description: choice.description,
      icon: choice.icon,
      selected: choice.value === current,
      keepOpen: true,
      onSelect: () => onPick(choice.value),
    })),
  }
}
