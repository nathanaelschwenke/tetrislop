# Optional UI graphics

Drop PNGs here to replace the canvas fallbacks (all optional):

| File               | Used for                                   | Suggested size |
|--------------------|--------------------------------------------|----------------|
| `background.png`   | full-screen background (scaled to cover)   | 1920×1080      |
| `board_frame.png`  | frame around the 10×20 well (stretched)    | ~ 1:2 ratio, transparent centre |
| `logo.png`         | title above the board (fit, aspect kept)   | ~ 5:1 ratio, transparent |

Tetromino blocks are never images: they are always drawn as vector cells.
