# LuaX

**Make small games in the browser with Lua.**

LuaX is a free, single-page game editor + runtime. Write Lua, draw pixel sprites, compose chiptune music, and press Play — all in your browser. No install, no build step.

**Live app:** [https://luax.pages.dev](https://luax.pages.dev)

---

## Features

- **Lua in the browser** — powered by [Fengari](https://fengari.io/)
- **Code editor** — CodeMirror with Lua mode, autocomplete, hover docs, error highlighting
- **Pixel sprite editor** — layers, palette, spectrum/HSV picker, zoom/pan, flood fill, undo/redo
- **Music step sequencer** — multi-channel grid, live preview, random generator, save as `.music`
- **Play mode** — canvas rendering, on-screen gamepad (mobile), keyboard + mouse (desktop)
- **Built-in templates** — empty, demo, top-down shooter, platformer, raycast 3D, runner, breakout, race
- **Cloud sync** — projects saved to your private Google Drive app folder
- **Share links** — one-click playable links (`#play=...`)
- **Particle FX** — `fx.burst`, `fx.spark`, `fx.dust`, `fx.smoke`, `fx.confetti`
- **Game data API** — persist high scores / progress with `data.save` / `data.load`
- **Pro plan** (€5/mo) — higher weekly credits + larger music grids (up to 16 channels × 64 steps)

Editing and playing are free. Credits are only used for cloud backup and project export.

---

## Quick start

1. Open [https://luax.pages.dev](https://luax.pages.dev)
2. Sign in with Google
3. Create a project (pick a template or start empty)
4. Edit `main.lua` (and other files)
5. Press **PLAY**

### Minimal example

```lua
function _update(dt)
end

function _draw()
    gfx.cls("#0d1118")
    gfx.circlefill(160, 120, 24, "#8b5cf6")
    gfx.text("Hello LuaX", 110, 180, "#fff", "18px sans-serif")
end
```

---

## Lua API (essentials)

### Graphics
| Call | Description |
|------|-------------|
| `gfx.cls(color?)` | Clear screen |
| `gfx.rect / rectfill` | Outline / filled rectangle |
| `gfx.circle / circlefill` | Outline / filled circle |
| `gfx.line` | Line |
| `gfx.text(str, x, y, color?, font?)` | Draw text |
| `gfx.sprite(name, x, y, w?, h?)` | Draw imported PNG |
| `gfx.anim(sheet, frame, x, y, ...)` | Draw frame from sprite sheet |
| `gfx.raycast(opts)` | Wolfenstein-style 3D |
| `gfx.width() / height()` | Logical screen size |

### Input
| Call | Description |
|------|-------------|
| `btn(i)` / `btnp(i)` / `btnr(i)` | Held / pressed / released (0–7) |
| `axis(0)` / `axis(1)` | Analog stick X / Y |
| `look()` | Returns yaw, pitch deltas |
| `mouse.x` / `mouse.y` / `mouse.btn` | Pointer |

### Audio
| Call | Description |
|------|-------------|
| `sfx.beep(freq, dur?, type?)` | Short beep |
| `sfx.music(name_or_table)` | Play saved pattern or inline grid |
| `sfx.stop()` / `sfx.playing()` | Control music |
| `sfx.note("C4")` | Note name → Hz |

### Effects & data
| Call | Description |
|------|-------------|
| `fx.burst(x, y, color?, count?)` | Explosion-style particles |
| `fx.spark` / `dust` / `smoke` / `confetti` | Other presets |
| `data.save(key, value)` | Persist player data |
| `data.load(key, default?)` | Load player data |

### Callbacks
```lua
function _update(dt)  -- game logic (dt in seconds)
end

function _draw()      -- drawing
end
```

Use `require("otherfile")` to load another `.lua` in the same project.

---

## Project structure

```
luax/
├── index.html      # Full app (editor + engine)
├── styles/
│   └── main.css
├── src/
│   └── modal.js
├── worker.js       # Cloudflare Worker (Stripe + credits)
└── wrangler.jsonc
```

The app is intentionally a **single-file** experience for users — open the URL and play.

---

## Tech stack

- **Runtime:** Fengari (Lua 5.3 in JS)
- **Editor:** CodeMirror 5
- **Graphics:** Canvas 2D
- **Audio:** Web Audio API
- **Auth / cloud:** Google Identity + Drive `appDataFolder`
- **Billing:** Stripe (Checkout + Customer Portal)
- **Hosting:** Cloudflare Pages (`luax.pages.dev`) + Cloudflare Worker

---

## Credits system

| Action | Cost |
|--------|------|
| Cloud backup (≈1/hour) | 2 credits |
| Project export | 2 credits |

| Plan | Weekly credits | Music grid |
|------|----------------|------------|
| Free | 25 | 10 channels × 16 steps |
| Pro (€5/mo) | 250 | 16 channels × 64 steps |

Editing, sprite tools, music editing, and Play are always free.

---

## Development notes

- Main logic lives in `index.html` (single-file app).
- Styles are in `styles/main.css`.
- Stripe / credits backend is `worker.js` (Cloudflare Workers).

To run locally, just open `index.html` in a browser (Google auth and Stripe need the real origin / HTTPS for full functionality).

---

## License

Personal project. Feel free to open issues or suggest improvements.
