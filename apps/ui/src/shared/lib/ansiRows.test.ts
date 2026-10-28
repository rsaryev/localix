import { describe, expect, test } from 'bun:test'

import { parseAnsiRows, plainAnsiText } from './ansiRows'

/** What a status line command's output says to draw: its rows, and the colors and links in them. */
const ESC = '\u001b'

describe('rows', () => {
  test('each printed line is its own row, spacing kept', () => {
    const rows = parseAnsiRows('first  row\n\nthird')
    expect(rows.map(plainAnsiText)).toEqual(['first  row', '', 'third'])
  })
})

describe('colors and styles', () => {
  test('a named color runs until its reset', () => {
    const [row] = parseAnsiRows(`a${ESC}[32mgreen${ESC}[0m b`)
    expect(row).toEqual([{ text: 'a' }, { text: 'green', fg: 'green' }, { text: ' b' }])
  })

  test('bright, 256-color and truecolor foregrounds and backgrounds', () => {
    const [row] = parseAnsiRows(`${ESC}[91mA${ESC}[38;5;2mB${ESC}[38;2;255;0;0;48;5;232mC${ESC}[0m`)
    expect(row).toEqual([
      { text: 'A', fg: 'redBright' },
      { text: 'B', fg: 'green' },
      { text: 'C', fg: '#ff0000', bg: '#080808' },
    ])
  })

  test('bold, dim, italic, underline, strike and inverse come on and go off', () => {
    const [row] = parseAnsiRows(`${ESC}[1;2;3;4;7;9mx${ESC}[22;23;24;27;29my`)
    expect(row).toEqual([
      {
        text: 'x',
        bold: true,
        dim: true,
        italic: true,
        underline: true,
        inverse: true,
        strike: true,
      },
      { text: 'y' },
    ])
  })

  test('a row starts plain: a color left open does not reach the next row', () => {
    const rows = parseAnsiRows(`${ESC}[31mred\nnext`)
    expect(rows[1]).toEqual([{ text: 'next' }])
  })

  test('sequences it does not draw leave the text alone', () => {
    const [row] = parseAnsiRows(`a${ESC}[2Jb${ESC}[38;9;1mc`)
    expect(plainAnsiText(row!)).toBe('abc')
  })
})

describe('links', () => {
  test('an OSC 8 link makes its text a link, ended by ST or BEL', () => {
    const [row] = parseAnsiRows(
      `go ${ESC}]8;;https://example.com/a${ESC}\\site${ESC}]8;;${ESC}\\ and ${ESC}]8;id=1;mailto:a@b.c\u0007mail${ESC}]8;;\u0007`,
    )
    expect(row).toEqual([
      { text: 'go ' },
      { text: 'site', href: 'https://example.com/a' },
      { text: ' and ' },
      { text: 'mail', href: 'mailto:a@b.c' },
    ])
  })

  test('only web and mail links are links; the text of any other stays', () => {
    const [row] = parseAnsiRows(
      `${ESC}]8;;javascript:alert(1)${ESC}\\x${ESC}]8;;file:///etc/passwd${ESC}\\y`,
    )
    expect(row).toEqual([{ text: 'x' }, { text: 'y' }])
  })
})
