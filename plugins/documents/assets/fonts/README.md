# Document fonts

Full Unicode font assets are sourced from the upstream Google Fonts repository, rather than
Latin-only webfont subsets. Each family is distributed under the adjacent SIL Open Font License.
Variable families were instantiated to static regular/bold and upright/italic TTF faces with
fontTools. Families without italics use their upstream upright face for that slot.

Sources: `https://github.com/google/fonts/tree/main/ofl/<family>` where family directories are
`inter`, `carlito`, `arimo`, `roboto`, `opensans`, `sourcesans3`, `lora`, `tinos`, `ebgaramond`,
`sourceserif4`, `merriweather`, `geistmono`, `jetbrainsmono`, `courierprime`, and `ibmplexmono`. The
Tinos license comes from `https://github.com/googlefonts/tinos/blob/main/OFL.txt`.

`fonts.ts` lazily reads the files for PDF generation and browser thumbnails. PDF character coverage
is checked with fontkit; Inter supplies missing glyphs where available. Courier Prime has no
Cyrillic coverage and therefore uses that fallback for Cyrillic text. No source font files from
Lanjut are redistributed.
