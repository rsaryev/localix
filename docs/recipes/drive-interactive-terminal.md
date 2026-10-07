# Drive an interactive program efficiently

Each terminal action can send input and observe its result in one call. Use that result to decide
what comes next, and reserve additional reads for output or choices it did not show.

## Start and await readiness

Open an interactive program and await its actual prompt together:

```json
{
  "action": "open",
  "command": "python3 -q",
  "wait_for": ">>>",
  "wait_timeout_ms": 5000
}
```

The result includes a terminal id and a rendered screen. Use that id for subsequent calls.

## Send known input together

Text and trailing keys belong in the same call. This example enters an expression and waits for the
printed result instead of the echoed expression:

```json
{
  "action": "type",
  "terminal_id": "<id from open>",
  "text": "print('ANSWER=' + str(6 * 7))",
  "keys": ["Enter"],
  "wait_for": "ANSWER=42",
  "wait_timeout_ms": 5000
}
```

Batch known editing keys too: `keys: ["Up", "Ctrl+A", "Ctrl+K"]` can recall and clear a shell
command without reading a screen between each key. Stop a batch where the next choice depends on the
application's response. In a menu, verify the selection before submitting it.

Input actions already return a screen. A separate `screen` read of the same result usually adds no
evidence. Use `wait_for` for delayed response text; a previously visible marker can refer to an old
response, and quiet output alone does not establish completion.

## Finish and observe exit together

When the program should exit, await that exit in the input call:

```json
{
  "action": "type",
  "terminal_id": "<id from open>",
  "text": "exit()",
  "keys": ["Enter"],
  "wait_for_exit": true,
  "wait_timeout_ms": 5000
}
```

The result reports exit or timeout and includes the retained final screen when available. Inspect
the output for failure; process exit alone does not establish success. This avoids a separate `list`
call just to confirm that this terminal closed.

Large automatic observations include a clipping notice. Read `action: "screen"` if the next decision
needs the omitted area. For accumulated background output, use `jobs action: "read"`; retained logs
are bounded, so direct output to a file when every line must remain available.

Read [Interactive terminals](../features/interactive-terminals.md) for the complete observation and
waiting contract.
