import { join } from "node:path";
import { getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getCapabilities, getCellDimensions } from "@earendil-works/pi-tui";
import { RenderCache, cacheKey } from "./src/cache.ts";
import { loadConfig, type Config } from "./src/config.ts";
import { DisplayStore, foreground } from "./src/display.ts";
import { splitMath } from "./src/math.ts";
import { watchCellSize, type CellSizeWatcher } from "./src/cell-size.ts";

export default function (pi: ExtensionAPI) {
	if (typeof pi.registerMarkdownTransformer !== "function") {
		throw new Error("pi-rich-renderer requires Pi with registerMarkdownTransformer (tested on 1.1.0)");
	}
	const cache = new RenderCache(join(getAgentDir(), "cache", "rich-renderer-v2"));
	const display = new DisplayStore();
	let active: ExtensionContext | undefined;
	let config: Config | undefined;
	let lifecycle = new AbortController();
	let warned = false;
	let cellWatcher: CellSizeWatcher | undefined;

	pi.registerCommand("formula-status", {
		description: "Show formula sizing and the latest terminal cell-size report",
		handler: async (_args, ctx) => {
			if (ctx.mode !== "tui") return;
			cellWatcher?.refresh();
			const cell = getCellDimensions();
			const report = cellWatcher?.lastReport();
			const sizing = config?.imageSizing === "font" ? `font ×${config.fontScale}` : `pixels ×${config?.imageScale}`;
			ctx.ui.notify(`Formula sizing: ${sizing}; DPI ${config?.dpi}; cell ${cell.widthPx}×${cell.heightPx}px. ${report ? `Last terminal report ${Math.round((Date.now() - report.at) / 1000)}s ago.` : "No terminal report received by this extension yet; metrics may be Pi's fallback."}`, "info");
		},
	});

	// This is the ONLY display transformation. No message replacement, context hook,
	// custom session field, persisted PNG, or terminal escape in the conversation.
	pi.registerMarkdownTransformer((markdown, context) => {
		if (!active || active.mode !== "tui" || !config?.showImages || context.messageType !== "assistant" || context.isStreaming) return markdown;
		return display.transform(markdown, context.availableWidth, active.ui.theme, config.imageScale, config.dpi, config.imageAlign, config.outputPad, config);
	});

	async function prepare(texts: string[], ctx: ExtensionContext): Promise<void> {
		if (ctx.mode !== "tui" || getCapabilities().images !== "kitty" || !config?.showImages) return;
		const current = config;
		const fg = foreground(ctx.ui.theme);
		const sources = new Set<string>();
		for (const text of texts) {
			if (text.length > 100000) continue;
			for (const segment of splitMath(text)) {
				if (segment.type === "math" && segment.source.length <= 8192 && sources.size < 12) sources.add(segment.source);
			}
		}
		const signal = AbortSignal.any([lifecycle.signal, AbortSignal.timeout(15000), ...(ctx.signal ? [ctx.signal] : [])]);
		for (const source of sources) {
			if (signal.aborted) break;
			const key = cacheKey(source, fg, current.dpi);
			if (display.has(key)) continue;
			try {
				const png = await cache.render(source, fg, { dpi: current.dpi, timeoutMs: current.timeoutMs, signal });
				if (!signal.aborted) display.put(key, png);
			} catch {
				if (!warned && !signal.aborted) {
					warned = true;
					ctx.ui.notify("Formula rendering failed; keeping original LaTeX. Check bwrap/prlimit, latex/dvipng, TeX packages and formula syntax. Further failures are silent until reload.", "warning");
				}
			}
		}
	}

	pi.on("session_start", async (_event, ctx) => {
		cellWatcher?.stop();
		cellWatcher = undefined;
		lifecycle.abort();
		lifecycle = new AbortController();
		display.clear();
		warned = false;
		active = ctx;
		config = await loadConfig(getAgentDir(), ctx.cwd, ctx.isProjectTrusted());
		if (ctx.mode !== "tui") return;
		if (config.showImages && getCapabilities().images === "kitty" && process.stdout.isTTY && process.stdin.isTTY) {
			cellWatcher = watchCellSize({
				// Pi clears raw mode while suspended / running an external editor.
				// Never emit queries while that other application owns the terminal.
				isActive: () => process.stdin.isRaw && getCapabilities().images === "kitty",
				write: (data) => { process.stdout.write(data); },
				getCell: getCellDimensions,
				onInput: (handler) => ctx.ui.onTerminalInput(handler),
				onResize: (handler) => {
					process.stdout.on("resize", handler);
					return () => { process.stdout.off("resize", handler); };
				},
			});
		}
		await cache.cleanup(config.cacheTtlMs).catch(() => {});
		// Warm only the latest assistant message on resume; bound startup latency.
		const last = [...ctx.sessionManager.getBranch()].reverse().find((entry) => entry.type === "message" && entry.message.role === "assistant");
		if (last?.type === "message" && last.message.role === "assistant") {
			await prepare(last.message.content.filter((part) => part.type === "text").map((part) => part.text), ctx);
		}
	});
	pi.on("message_end", async (event, ctx) => {
		if (ctx.mode !== "tui" || event.message.role !== "assistant") return;
		if (!["stop", "length", "toolUse"].includes(event.message.stopReason)) return;
		active = ctx;
		await prepare(event.message.content.filter((part) => part.type === "text").map((part) => part.text), ctx);
		// Returning nothing deliberately preserves ALL original content and metadata.
	});
	pi.on("session_shutdown", () => {
		cellWatcher?.stop(); cellWatcher = undefined;
		lifecycle.abort(); display.clear(); active = undefined;
	});
}
