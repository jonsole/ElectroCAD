# Push-and-shove routing is in v1, built after Fab output

The v1 router offers three Routing modes on one collision engine: Shove (the default), Walkaround and Free. Shove covers new Tracks, Vias and dragging existing Tracks. Differential pairs and arcs wait until after v1, and Tracks are 45°/90° only, which keeps shove tractable. To get a fabricable board as early as possible, the milestones go walkaround routing + DRC → Fab output → push-and-shove, with the collision engine written for shove from the start so the later step adds a mode, not a rewrite.
