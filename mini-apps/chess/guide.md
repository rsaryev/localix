_Use: Play chess with the user on this chat's chess board: answer a move when the board wakes the
chat, start a game when the user asks to play, resign a lost game, and talk about the position
shown. Use for "let's play chess", a woken "your move", or a question about the game on the board._

# Play chess

Each chat has its own board, and this chat's is yours to play: the user plays one colour, you play
the other. White moves first. The board's new-game action can swap colours; the tool defaults the
user to white unless `userPlays` is provided. The board, not the chat, is where the game happens —
the user sees every move there, so the chat only needs a short line. The board keeps the score at
this table from game to game.

Everything goes through one tool, `chess`, and its `action`: `move`, `state`, `new_game`, `resign`.
Use `action` or `actions`, not both. A batch accepts up to 16 sequential steps; for a new game
followed by your first move, set `userPlays: "black"` on the `new_game` step. It stops when a
mutation hands the turn to the user, the game ends, you resign, or a step is refused. Completed
steps remain applied; read the completion count and current board before continuing.

The board enforces castling, en passant, promotion, check, and the draws by stalemate, threefold
repetition, the fifty-move rule and insufficient material. You never need to work out whether a move
is legal: the legal moves are listed for you.

## When the decision model plays your side

The user can choose, on the board, who plays the colour opposite theirs: you, or a decision model
the board asks itself. When the board says the decision model plays it, you do not move or resign —
both are refused — and the board never wakes you; a new game you open gives the user white. You can
still read the board and talk about the position. To play against you again, the user switches the
opponent back on the board.

## When the board wakes you

A message from the "chess" mini app, not typed by the user, means it is your move. It carries the
last move, the board, the FEN, the list of legal moves in SAN and the score so far.

Call `chess` with action `move` and one move from that list, written as listed ("e4", "Nf3",
"Bxc6+", "O-O", "e8=Q"), and nothing else: while the game goes on, the move ends your turn, because
the board shows it. When your move ends the game, the result asks for one short line — say it
without redrawing the board.

Play good, principled chess: develop pieces, control the centre, castle early, look for checks,
captures and threats before quiet moves, and never leave a piece hanging. If the move is refused,
the result shows the board as it is now — the game may have moved on (the user started a new game);
act on that board, and do not argue with it.

## When the game is lost

If the position is hopeless — mate is coming, or you are far down in material with no counterplay —
resign with action `resign` rather than play on to mate. Give one short `reason`. Do not resign a
game that is merely difficult: a draw or a swindle is still worth playing for.

## When a game ends

Tell the user the result in one line and offer another game. If the game showed you something about
how this user plays that you did not know — an opening they choose, a tactic they miss — keep it in
your memory, in one note on Chess that you update rather than add to. Use memory only when you have
it and may write there. The board is session-owned and is removed with its chat.

## When the user asks to play

Call `chess` with action `new_game` — it sets up this chat's board; give the user the result's
`App view` link. The user plays white (and moves first) unless they ask for black
(`userPlays: "black"`); then you play white, so make your first move straight away. Before the first
move, recall your Chess note if you have one.

## When the user asks about the game

When the board is open, the message carries it as context; otherwise read it with action `state`.
Never move for the user and never move when it is not your turn: the board wakes you when it is.
