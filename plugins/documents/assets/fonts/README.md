# Document fonts

This directory holds 60 TTF face files for 15 document font families, together with each family's
adjacent `*-OFL.txt` license. These are font files rather than Latin-only webfont subsets; their
character coverage still varies by family and face.

## Sources and face mapping

The upstream family directories are in the
[Google Fonts repository](https://github.com/google/fonts/tree/main/ofl): `inter`, `carlito`,
`arimo`, `roboto`, `opensans`, `sourcesans3`, `lora`, `tinos`, `ebgaramond`, `sourceserif4`,
`merriweather`, `geistmono`, `jetbrainsmono`, `courierprime`, and `ibmplexmono`. Tinos's license
also comes from the [Tinos upstream](https://github.com/googlefonts/tinos/blob/main/OFL.txt). Keep
the local family license beside its assets when updating the files.

The generator maps regular, bold, italic, and bold-italic slots explicitly. Geist Mono's italic
slots use its upright regular/bold faces; a filename alone does not determine the selected face.
`fontBytes` reads each selected file lazily and caches the resulting promise.

## Character coverage

PDF generation checks each non-whitespace character through fontkit. A missing glyph falls back to
the corresponding Inter face. If Inter also lacks it, generation rejects that paragraph with the
character and code point; the fallback does not provide universal Unicode coverage.

The bundled Courier Prime regular face has no glyphs in the tested Cyrillic blocks U+0400–U+052F, so
supported Cyrillic text uses Inter. Neither tested regular face contains the CJK character U+4E00.
Check the actual selected faces when adding a script or changing assets.

## Source of truth

- [Face mapping, lazy reads, and PDF registration](../../backend/documents/generators/fonts.ts)
- [Per-character coverage and failure behavior](../../backend/documents/generators/font-coverage.ts)
- [Courier Prime license](CourierPrime-OFL.txt)
- [Inter license](Inter-OFL.txt)
- [Tinos license](Tinos-OFL.txt)
