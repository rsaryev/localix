import {
  ALargeSmall,
  Circle,
  Code,
  Cloud,
  Crop,
  Cylinder,
  Diamond,
  FileText,
  Hexagon,
  Image as ImageIcon,
  PaintBucket,
  RectangleHorizontal,
  Square,
  Spline,
  SquareDashed,
  Star,
  Triangle,
} from 'lucide-react'
import type { ElementControl } from './contract'

/**
 * Control descriptions several types share — the palette, the text sizes, the line styles — so
 * the same control reads the same everywhere it appears.
 */
export const colorControl: ElementControl = { kind: 'color', prop: 'color', label: 'Colour' }

const SIZE_LABEL: Record<string, string> = {
  s: 'Small',
  sm: 'Small',
  m: 'Medium',
  md: 'Medium',
  l: 'Large',
  lg: 'Large',
  xl: 'Extra large',
  auto: 'Fit to note',
}

/** A text-size picker over the size names a type uses (`s…xl`, the text type's `sm…xl`, `auto`). */
export const sizeControl = (values: readonly string[]): ElementControl => ({
  kind: 'choice',
  prop: 'size',
  label: 'Text size',
  Icon: ALargeSmall,
  group: 'text',
  options: values.map((value) => ({ value, label: SIZE_LABEL[value] ?? value })),
})

export const strokeControl: ElementControl = {
  kind: 'choice',
  prop: 'stroke',
  label: 'Line',
  Icon: Spline,
  options: [
    { value: 'solid', label: 'Solid' },
    { value: 'dashed', label: 'Dashed' },
    { value: 'dotted', label: 'Dotted' },
  ],
}

export const fillControl: ElementControl = {
  kind: 'choice',
  prop: 'fill',
  label: 'Fill',
  Icon: PaintBucket,
  options: [
    { value: 'none', label: 'None' },
    { value: 'tint', label: 'Tint' },
    { value: 'solid', label: 'Solid' },
  ],
}

/** The languages a snippet is coloured in as it is typed (the host highlighter's grammars). */
export const codeLanguageControl: ElementControl = {
  kind: 'choice',
  prop: 'language',
  label: 'Language',
  Icon: Code,
  options: [
    { value: '', label: 'Plain text' },
    { value: 'ts', label: 'TypeScript' },
    { value: 'tsx', label: 'TSX' },
    { value: 'js', label: 'JavaScript' },
    { value: 'python', label: 'Python' },
    { value: 'go', label: 'Go' },
    { value: 'rust', label: 'Rust' },
    { value: 'java', label: 'Java' },
    { value: 'c', label: 'C' },
    { value: 'cpp', label: 'C++' },
    { value: 'css', label: 'CSS' },
  ],
}

export const imageFitControl: ElementControl = {
  kind: 'choice',
  prop: 'fit',
  label: 'Image fit',
  options: [
    { value: 'contain', label: 'Whole picture', Icon: ImageIcon },
    { value: 'cover', label: 'Fill and crop', Icon: Crop },
  ],
}

export const shapeKindControl: ElementControl = {
  kind: 'choice',
  prop: 'kind',
  label: 'Shape',
  options: [
    { value: 'rectangle', label: 'Rectangle', Icon: Square },
    { value: 'rounded', label: 'Rounded', Icon: RectangleHorizontal },
    { value: 'ellipse', label: 'Ellipse', Icon: Circle },
    { value: 'diamond', label: 'Decision', Icon: Diamond },
    { value: 'triangle', label: 'Triangle', Icon: Triangle },
    { value: 'hexagon', label: 'Hexagon', Icon: Hexagon },
    { value: 'parallelogram', label: 'Input / output', Icon: SquareDashed },
    { value: 'cylinder', label: 'Database', Icon: Cylinder },
    { value: 'document', label: 'Document', Icon: FileText },
    { value: 'cloud', label: 'Cloud', Icon: Cloud },
    { value: 'star', label: 'Star', Icon: Star },
  ],
}
