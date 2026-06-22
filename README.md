# pi-rich-renderer

Local Pi extension that renders LaTeX formulas in assistant replies as tight terminal images.

It does not send rendered images to the model. Assistant context is restored to the original Markdown before the next LLM call.

## Requirements

- Pi coding agent
- A TeX installation with `latex` and `dvipng`

On macOS with MacTeX these are usually available at `/Library/TeX/texbin`.

## Install

Add the extension path to `~/.pi/agent/settings.json`:

```json
{
  "extensions": ["~/.pi/agent/extensions/pi-rich-renderer/index.ts"]
}
```

Then run `/reload` in Pi.

## Configuration

Configure in `~/.pi/agent/settings.json` or project-local `.pi/settings.json`:

```json
{
  "richRenderer": {
    "imageScale": 0.5,
    "cacheTtlMs": 604800000
  }
}
```

- `imageScale`: terminal display scale for rendered formula images. Default `0.5`.
- `cacheTtlMs`: delete cached PNGs older than this many milliseconds on extension load. Default `604800000` (7 days). Set `0` to disable cleanup.

Project `.pi/settings.json` overrides global settings.

## Cache

Rendered PNGs are cached in:

```text
~/.pi/cache/rich-renderer/
```

Cache keys are SHA-256 hashes of formula content, foreground color, and DPI.

## Notes

- Code blocks are not rendered as images; Pi's native Markdown code rendering is preserved.
- Formulas inside fenced code blocks are ignored.
- The extension rewrites only the displayed assistant message; the next model context receives the original Markdown.
