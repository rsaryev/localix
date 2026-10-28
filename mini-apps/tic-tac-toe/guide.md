_Use: Play tic-tac-toe with the user on this chat's Tic-Tac-Toe board: answer a move when the board
wakes the chat, start a game when the user asks to play, and talk about the position shown. Use for
"let's play", a woken "your move", or a question about the game on the board._

# Play tic-tac-toe

Each chat has its own board: the user plays X and you play O. The user starts by default;
`first: "agent"` makes O move first without swapping marks. The board, not the chat, is where the
game happens — the user sees every move there, so the chat only needs a short line. The board keeps
the score at this table from game to game.

Everything goes through one tool, `tic_tac_toe`, and its `action`: `move`, `state`, `new_game`. Use
`action` or `actions`, not both. A batch accepts up to 16 sequential steps; for a new game followed
by your first move, set `first: "agent"` on the `new_game` step. It stops when a mutation hands the
turn to the user, the game ends, or a step is refused. Completed steps remain applied; read the
completion count and current board before continuing.

## When the decision model plays O

The user can choose, on the board, who plays O: you, or a decision model the board asks itself. When
the board says the decision model plays O, you do not move — a move is refused — and the board never
wakes you; a new game you open lets the user move first. You can still read the board and talk about
the position. To play against you again, the user switches the opponent back on the board.

## When the board wakes you

A message from the "tic-tac-toe" mini app, not typed by the user, means it is your move. It carries
the position, the free cells and the score so far.

Call `tic_tac_toe` with action `move` and one free `cell` (1–9, left to right, top to bottom) and
nothing else: while the game goes on, the move ends your turn, because the board shows it. When your
move ends the game, the result asks for one short line — say it without redrawing the board.

Play to win: take a winning cell, else block the user's winning cell, else prefer the centre, then a
corner. If the move is refused, the result shows the board as it is now — the game may have moved on
(the user started a new game); act on that board, and do not argue with it.

## When a game ends

Tell the user the result in one line and offer another game. If the game showed you something about
how this user plays that you did not know — an opening they favour, a trap they fall for — keep it
in your memory, in one note on Tic-Tac-Toe that you update rather than add to. Use memory only when
you have it and may write there. The board is session-owned and is removed with its chat.

## When the user asks to play

Call `tic_tac_toe` with action `new_game` — it sets up this chat's board; give the user the result's
`App view` link. Let the user move first unless they ask you to start (`first: "agent"`); then make
your move straight away. Before the first move of a session, recall your Tic-Tac-Toe note if you
have one.

## When the user asks about the game

When the board is open, the message carries it as context; otherwise read it with action `state`.
Never move for the user and never move when it is not your turn: the board wakes you when it is.
