# Initial audit and hardening

Baseline: `6f770c2` (upstream initial implementation).
Target: installed Pi 1.1.0, Linux, Ghostty / Herdr Kitty graphics.

## Findings and changes

| Severity | Finding | Resolution |
|---|---|---|
| High | TeX inherits agent environment and can access host files; no explicit shell-escape disable or OS isolation | Both converters run in fail-closed Bubblewrap sandbox, clean environment, restricted mounts, no network, shell/PostScript disabled, resource limits |
| High | `message_end` replaces the assistant payload with terminal image sequences, removes other content blocks, and persists an ad-hoc original-content field | Removed replacement and context restoration; public Markdown transformer changes only interactive display |
| High | Runtime copies of Pi packages can bypass host module identity, break global capabilities and inflate installation | Pi packages are peers, pinned dev copies only; added explicit Pi extension manifest |
| Medium | Image rows collapse in Markdown; Kitty ST backslash can be consumed as a Markdown hard break | Image and blank-row paragraphs separated, ST escaped through Markdown; tested row reservation, ST preservation and unique placements |
| Medium | Inline code, long/unclosed fences, escaped delimiters and mismatched environments can be misidentified | Conservative scanner with preservation tests; complex Markdown containers left unchanged |
| Medium | Images baked at one terminal width/color do not respond correctly to resize | Generate at display time using current width/cell dimensions; color mismatch falls back instead of using stale colors |
| Medium | Print/JSON/RPC and unsupported terminals execute TeX and can receive terminal output | TUI + Kitty + showImages guards; no source mutation in any mode |
| Medium | Project settings read before trust, from process-start cwd; hard-coded agent directory | Honor trust, context cwd and host `getAgentDir()` |
| Medium | Unbounded environment values, formula/message count and output/cache size | Validated settings; message/formula budgets, cancellation, image/cache limits |
| Medium | Cache reads race, writes can be partial, filesystem errors escape render error handling | Atomic writes, no-follow file reads, validation, caught startup cleanup failures and render fallback |
| Low | Async cleanup starts unobserved in extension factory | No startup I/O in factory; awaited/caught session-start cleanup |
| Low | Blanket `any` hides extension contract violations | Strict TypeScript with real host interfaces; mocks explicitly isolated to tests |
| Release blocker | No upstream license | Mark package private; retain provenance; require license clarification before redistribution |

Lockfile was regenerated from the official npm registry. The inherited lockfile
mixed npmjs and npmmirror URLs and failed under the local npm remote-fetch policy.
The development Pi 1.1.0 dependency family is pinned: accepting codemode 1.2.0 via
its upstream caret range caused an import-time missing-export error.

## Verification

- Reproducible install verified with `npm ci --ignore-scripts` on local Node 26.11.1.
- `npm run check`: strict typecheck, 22 passing tests and 2 integration-only skips.
- `npm run test:integration`: all 24 tests pass, including real TeX matrix/fraction rendering, valid PNG,
  disk-cache hit, corruption recovery, hidden host files, timeout, and actual
  extension handler + display transformer behavior without changing messages.
- Native Pi `Markdown` is exercised at widths 2, 20, 80 and 100; image terminators,
  row accounting and distinct placements are asserted, not just PNG generation.
- `npm audit`: zero reported dependency advisories at review time (not a security guarantee).
- `npm pack --dry-run` and `git diff --check` pass. CI is configured for Node 22;
  the remote workflow has not been run or pushed.
- These are automated tests, not proof of correct painting by a physical terminal.

## Known tradeoffs / follow-up

1. Manually test final output, repeated formulas, scrolling, resize, theme switches,
   reload and resume in Ghostty and Herdr, regular and fullscreen modes.
2. Restrict this release to Kitty graphics on Linux; never silently run TeX without
   isolation. A portable KaTeX/MathJax backend could be considered separately.
3. Images occupy block rows. Markdown lists/tables/links etc. are conservative
   fallback cases; full structural Markdown integration needs a richer component API.
4. Only the latest assistant reply is warmed on resume; old or evicted formulas
   use Pi's existing renderer. Theme changes can similarly fall back until reload.
5. Disk pruning runs at session start, not continuously. CPU/file/memory limits do
   not make arbitrary TeX immune to every resource-exhaustion technique.
6. The old v0.1 session mutation is not automatically migrated. This fork does not
   rewrite existing session files; avoid using old transformed sessions as proof
   of the new display-only behavior.
7. Pi 1.1.0 already includes Unicode LaTeX rendering. Earlier web-search-based
   claims that Pi has no math renderer were too broad; this extension's distinct
   purpose is genuine TeX image layout.
