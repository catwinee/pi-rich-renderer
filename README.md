# pi-rich-renderer (maintained fork)

Render LaTeX in **finalized assistant replies** as TeX-quality terminal images.
This fork targets Linux + Kitty graphics (including Ghostty and Herdr).

## Design

- Uses Pi's public `registerMarkdownTransformer`, not message replacement.
- Original text, thinking signatures, tool calls, session files, model context and exports are unchanged.
- Images are display-only: no PNGs or terminal escape sequences are saved to the conversation.
- No rendering subprocess during streaming, in print/JSON/RPC modes, or when images are unsupported/disabled.
- Errors leave the original Markdown for Pi to render. Pi 1.1.0 already has a Unicode LaTeX renderer; fallback may therefore appear as Unicode, not literal source.

## Requirements

- Pi with `registerMarkdownTransformer`; tested against **1.1.0**.
- Linux, `/usr/bin/bwrap` (Bubblewrap) and `/usr/bin/prlimit` (util-linux).
- `/usr/bin/latex`, `/usr/bin/dvipng`, a prebuilt LaTeX format, and the TeX packages
  `preview`, `amsmath`, `amssymb`, `mathtools`, `bm`.
- Kitty graphics support. In Herdr, Pi may need `PI_IMAGE_PROTOCOL=kitty`.

There is **no unsandboxed fallback**. macOS, Windows and iTerm2-only terminals
currently keep Pi's ordinary Markdown rendering.

## Try locally

Review the source, then launch a separate Pi instance:

```sh
cd ~/Workspace/pi-rich-renderer
pi -e ./index.ts
```

Pi supplies the runtime packages; no production dependency installation is needed.
To keep it enabled, add the absolute path to the existing `extensions` array in
`~/.pi/agent/settings.json` (do not replace your other entries):

```json
{
  "extensions": ["/home/Catwine/Workspace/pi-rich-renderer/index.ts"]
}
```

Then `/reload`. This repository's development work does **not** enable it automatically.

If your AGENTS.md forbids LaTeX output, explicitly ask for a LaTeX test or adjust
that instruction yourself. The extension does not modify prompts or instructions.

## Supported input

- Display: `$$...$$`, `\[...\]`.
- Inline: `$...$`, `\(...\)`; images occupy their own terminal rows, not inline glyph positions.
- Matching `equation`, `align`, `gather`, `multline`, `flalign`, `alignat` environments, optionally starred.
- Code spans, fenced code (including unclosed fences), and indented code are preserved.
- Lists, blockquotes, headings, link-containing lines, HTML-starting lines, and lines with `|`
  are conservatively left to Pi. Put complex formulas in a separate top-level display block.

This is not a full Markdown/TeX parser. Currency and deeply nested Markdown remain
ambiguous; use explicit display delimiters for reliable results.

## Configuration

Use `richRenderer` in the agent directory's `settings.json`, or a **trusted**
project's `.pi/settings.json`. The agent directory respects `PI_CODING_AGENT_DIR`.
Project paths resolve from the current session's working directory.

```json
{
  "richRenderer": {
    "imageScale": 0.5,
    "cacheTtlMs": 604800000
  }
}
```

- `imageScale`: 0.1–2, default 0.5.
- `cacheTtlMs`: 0–31536000000, default 7 days; 0 disables age-based pruning.
- `terminal.showImages: false` also disables this extension's images.
- `PI_RICH_RENDER_TIMEOUT_MS`: per-process wall timeout, 100–15000 ms, default 5000.
- `PI_RICH_RENDER_LATEX_DPI`: 72–300, default 180.
- Reload after changing configuration. Invalid values use defaults.

## Bounds and cache

- At most 12 distinct formulas per message, 8192 characters per formula.
- Messages over 100000 characters are left to Pi.
- 15-second total preparation budget per message, with cancellation on abort/shutdown.
- CPU, address-space, file-size, descriptor and process-output limits for subprocesses.
- PNGs: at most 2 MiB, 8192 pixels per side and 16 million pixels total.
- Memory cache: at most 64 formulas / 8 MiB of base64 payload.
- Disk cache: `<agent-dir>/cache/rich-renderer-v2/`; private directories/files,
  atomic writes, validation on read, and no symlink reads.
- At TUI session start, remove expired PNGs and prune to 64 MiB. The disk cache
  may grow beyond that between starts. Cache identity includes source, color, DPI
  and renderer version; after upgrading system TeX/fonts, clear it manually.

On resume, only the newest assistant message is warmed automatically. Older
uncached formulas remain in Pi's normal rendering. Changing the theme's foreground
falls back to Pi until matching formulas are prepared again (e.g. `/reload` for
the latest message). Images resize with the terminal; oversized math is scaled,
not reflowed. Real Ghostty/Herdr scrolling and theme transitions still need manual QA.

## Security

TeX is a programming language. Rendering executes **untrusted model output**.
Both `latex` and `dvipng` run inside Bubblewrap with:

- separate namespaces, no network, and no host home/project/temp directory;
- read-only system runtime/TeX/font trees and only a disposable work directory writable on the host;
- a clean environment (no agent credentials), disabled TeX shell escape,
  paranoid TeX file I/O, disabled format/font auto-generation;
- Ghostscript/PostScript conversion disabled, timeouts and resource limits.

Sandbox or TeX failure leaves the original Markdown intact. The first failure per
session produces a generic warning; renderer logs containing model text are not
persisted. This is defense in depth, **not** a guarantee against kernel/TeX bugs
or all denial-of-service attacks. Keep system packages updated. Cache PNGs can
contain sensitive formula text; delete the cache when appropriate.

## Development

```sh
npm ci --ignore-scripts
npm run check
npm run test:integration  # real sandboxed TeX; Linux dependencies required
npm pack --dry-run
```

Dev-only host packages are pinned to the tested Pi release. Host-provided packages
are peers, not runtime dependencies. Overrides keep the Pi 1.1.0 development stack
consistent (mixing its codemode with 1.2.0 currently breaks imports).

See [AUDIT.md](AUDIT.md) for findings, fixes and remaining manual verification.

## Provenance and license

Based on `dbydd/pi-rich-renderer`, fork baseline `6f770c2`.
The inherited repository contains **no LICENSE**. This fork is marked `private`
to prevent accidental npm publication. Do not assume permission to redistribute
upstream code under a new license; clarify licensing with the original author
before publishing. No license has been invented or silently assigned here.
