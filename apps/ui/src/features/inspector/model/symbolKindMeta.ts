import { Braces, Box, Variable, Hash, Type, Circle } from 'lucide-react'

/**
 * LSP `SymbolKind` (1-based numeric enum) → a compact icon + label. Grouped so
 * outlines read cleanly without a 26-icon zoo. Shared by the go-to-symbol palette
 * and the editor Outline panel so both render symbols identically.
 */
export function symbolKindMeta(kind: number): { Icon: typeof Braces; label: string } {
  switch (kind) {
    case 6:
    case 9:
    case 12:
      return { Icon: Braces, label: kind === 12 ? 'function' : 'method' }
    case 2:
    case 3:
    case 4:
    case 5:
    case 10:
    case 11:
    case 23:
      return {
        Icon: Box,
        label: kind === 11 ? 'interface' : kind === 5 ? 'class' : kind === 10 ? 'enum' : 'type',
      }
    case 7:
    case 8:
    case 13:
    case 14:
      return {
        Icon: Variable,
        label: kind === 14 ? 'constant' : kind === 13 ? 'variable' : 'field',
      }
    case 16:
    case 22:
      return { Icon: Hash, label: 'value' }
    case 26:
      return { Icon: Type, label: 'type param' }
    default:
      return { Icon: Circle, label: 'symbol' }
  }
}
