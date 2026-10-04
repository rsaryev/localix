/**
 * A sugar-high grammar for Mermaid, the diagram source the transcript shows behind every diagram.
 *
 * sugar-high ships no Mermaid preset, and `highlightCode` falls back to escaped plain text for a
 * language it has no grammar for (its default grammar is JavaScript, which would colour a diagram
 * as a script) — so a diagram's source view was the one code block in a reply without colour.
 * A preset is only data in sugar-high's own shape (the bundled Python and Go ones are the same
 * three fields): the diagram and structure words as keywords, the layout directions as types,
 * and `%%` line comments. Quoted labels and arrows are coloured by the default string and sign
 * rules.
 */
export const mermaid = {
  keywords: new Set([
    // Diagram types. `stateDiagram-v2` tokenizes as `stateDiagram`, `-`, `v2`.
    'flowchart',
    'graph',
    'sequenceDiagram',
    'classDiagram',
    'stateDiagram',
    'erDiagram',
    'gantt',
    'pie',
    'journey',
    'gitGraph',
    'mindmap',
    'timeline',
    'quadrantChart',
    'xychart',
    'sankey',
    'radar',
    'treemap',
    // Structure.
    'subgraph',
    'end',
    'participant',
    'actor',
    'loop',
    'alt',
    'else',
    'opt',
    'par',
    'and',
    'critical',
    'break',
    'rect',
    'note',
    'over',
    'activate',
    'deactivate',
    'state',
    'section',
    'title',
    'dateFormat',
    'axisFormat',
    'class',
    'classDef',
    'style',
    'linkStyle',
    'click',
    'direction',
    'bar',
    'line',
    'axis',
    'curve',
    'showLegend',
    'ticks',
    'graticule',
  ]),
  typeKeywords: new Set(['LR', 'RL', 'TB', 'TD', 'BT']),
  // sugar-high reads these as a comment TYPE (1 = runs to the end of the line), not a length:
  // the end callback must answer the same type, or the comment never closes.
  onCommentStart: (current: string, next: string) => (current === '%' && next === '%' ? 1 : 0),
  onCommentEnd: (_previous: string, current: string) => (current === '\n' ? 1 : 0),
}
