/** SQL fences used to be escaped plain text: sugar-high has no SQL preset. */
export const sql = {
  keywords: new Set(
    'SELECT FROM WHERE GROUP BY HAVING ORDER LIMIT OFFSET AS WITH DISTINCT ALL UNION JOIN INNER LEFT RIGHT FULL OUTER CROSS ON USING INSERT INTO VALUES UPDATE SET DELETE CREATE ALTER DROP TABLE DATABASE VIEW INDEX IF EXISTS NOT NULL DEFAULT PRIMARY KEY FOREIGN REFERENCES ENGINE PARTITION SETTINGS MATERIALIZED TTL AND OR IN IS LIKE BETWEEN CASE WHEN THEN ELSE END ASC DESC TRUE FALSE EXPLAIN FORMAT SAMPLE PREWHERE FINAL ARRAY GLOBAL ANY'
      .split(' ')
      .flatMap((word) => [word, word.toLowerCase()]),
  ),
  typeKeywords: new Set([
    'Int8',
    'Int16',
    'Int32',
    'Int64',
    'Int128',
    'UInt8',
    'UInt16',
    'UInt32',
    'UInt64',
    'Float32',
    'Float64',
    'String',
    'FixedString',
    'Date',
    'Date32',
    'DateTime',
    'DateTime64',
    'Decimal',
    'Nullable',
    'LowCardinality',
    'Array',
    'Tuple',
    'Map',
    'UUID',
    'MergeTree',
    'ReplacingMergeTree',
    'AggregatingMergeTree',
    'SummingMergeTree',
    ...'INT INTEGER BIGINT SMALLINT FLOAT DOUBLE DECIMAL NUMERIC VARCHAR CHAR TEXT BOOLEAN TIMESTAMP DATE'
      .split(' ')
      .flatMap((word) => [word, word.toLowerCase()]),
  ]),
  onCommentStart: (current: string, next: string) =>
    current === '-' && next === '-' ? 1 : current === '/' && next === '*' ? 2 : 0,
  onCommentEnd: (previous: string, current: string) =>
    current === '\n' ? 1 : previous === '*' && current === '/' ? 2 : 0,
}
