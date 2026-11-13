#!/usr/bin/env python3
"""Writes public/fonts/mono-blocks.woff2: the block elements (U+2580-U+259F) as rectangles that
fill a terminal cell exactly.

Neither mono font the site ships has these characters, so a browser takes them from a system
font whose cell is another size, and a program's block art in a recording (a logo drawn in
half and quarter blocks, say) is drawn with gaps between its cells. global.css adds this font to the Mono family for
just that range. The cell is JetBrains Mono's: 600 units wide, its ascent 1020 and descent 300,
grown by the film's line height (Film.tsx LINE, 1.15) so a block also covers the row's leading.

Run with fonttools and brotli installed: python3 scripts/block-font.py
"""
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

ADVANCE, ASCENT, DESCENT, LINE = 600, 1020, 300, 1.15
lead = (ASCENT + DESCENT) * (LINE - 1) / 2
BOTTOM, TOP = round(-DESCENT - lead), round(ASCENT + lead)
# Each block reaches a little past its cell so no hairline shows between cells. Leftward it
# reaches further: a terminal draws a run of cells with a background of its own after the run
# before it, and that background covers the softened right edge of the block before; this
# block's reach covers the seam again.
SEAM, REACH = 24, 80
X0, X1, Y0, Y1 = -REACH, ADVANCE + SEAM, BOTTOM - SEAM, TOP + SEAM
MID_X, MID_Y = ADVANCE / 2, (BOTTOM + TOP) / 2


def lower(eighths):
    return [(X0, Y0, X1, BOTTOM + (TOP - BOTTOM) * eighths / 8)]


def left(eighths):
    return [(X0, Y0, ADVANCE * eighths / 8, Y1)]


QUAD = {
    'ul': (X0, MID_Y, MID_X, Y1),
    'ur': (MID_X, MID_Y, X1, Y1),
    'll': (X0, Y0, MID_X, MID_Y),
    'lr': (MID_X, Y0, X1, MID_Y),
}


def quads(*names):
    return [QUAD[n] for n in names]


SHAPES = {
    0x2580: [(X0, MID_Y, X1, Y1)],
    **{0x2580 + n: lower(n) for n in range(1, 8)},
    0x2588: [(X0, Y0, X1, Y1)],
    **{0x2588 + n: left(8 - n) for n in range(1, 8)},
    0x2590: [(MID_X, Y0, X1, Y1)],
    # 2591-2593, the shades, are left to the system font: a pattern is not a rectangle.
    0x2594: [(X0, TOP - (TOP - BOTTOM) / 8, X1, Y1)],
    0x2595: [(ADVANCE * 7 / 8, Y0, X1, Y1)],
    0x2596: quads('ll'),
    0x2597: quads('lr'),
    0x2598: quads('ul'),
    0x2599: quads('ul', 'll', 'lr'),
    0x259A: quads('ul', 'lr'),
    0x259B: quads('ul', 'ur', 'll'),
    0x259C: quads('ul', 'ur', 'lr'),
    0x259D: quads('ur'),
    0x259E: quads('ur', 'll'),
    0x259F: quads('ur', 'll', 'lr'),
}


def glyph(rects):
    pen = TTGlyphPen(None)
    for x0, y0, x1, y1 in rects:
        x0, y0, x1, y1 = (round(v) for v in (x0, y0, x1, y1))
        pen.moveTo((x0, y0))
        pen.lineTo((x0, y1))
        pen.lineTo((x1, y1))
        pen.lineTo((x1, y0))
        pen.closePath()
    return pen.glyph()


names = ['.notdef'] + [f'uni{code:04X}' for code in sorted(SHAPES)]
glyphs = {'.notdef': TTGlyphPen(None).glyph()}
glyphs.update({f'uni{code:04X}': glyph(rects) for code, rects in SHAPES.items()})

fb = FontBuilder(1000, isTTF=True)
fb.setupGlyphOrder(names)
fb.setupCharacterMap({code: f'uni{code:04X}' for code in SHAPES})
fb.setupGlyf(glyphs)
# A glyph's left side bearing must be its outline's own left edge: a renderer places the outline
# by it, so a right half with a bearing of 0 would be drawn as a left half.
for g in glyphs.values():
    g.recalcBounds(None)
fb.setupHorizontalMetrics({name: (ADVANCE, getattr(glyphs[name], 'xMin', 0)) for name in names})
fb.setupHorizontalHeader(ascent=ASCENT, descent=-DESCENT)
fb.setupNameTable({'familyName': 'Mono Blocks', 'styleName': 'Regular'})
fb.setupOS2(sTypoAscender=ASCENT, sTypoDescender=-DESCENT, usWinAscent=ASCENT, usWinDescent=DESCENT)
fb.setupPost(isFixedPitch=1)
fb.font.flavor = 'woff2'
fb.save('public/fonts/mono-blocks.woff2')
print('wrote public/fonts/mono-blocks.woff2:', len(SHAPES), 'characters')
