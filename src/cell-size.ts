import type { CellDimensions } from "@earendil-works/pi-tui";
import type { TerminalInputHandler } from "@earendil-works/pi-coding-agent";

export interface CellSizeHost {
	isActive(): boolean;
	write(data: string): void;
	getCell(): CellDimensions;
	onInput(handler: TerminalInputHandler): () => void;
	onResize(handler: () => void): () => void;
}
export interface CellSizeWatcher {
	stop(): void;
	refresh(): void;
	lastReport(): { cell: CellDimensions; at: number } | undefined;
}

/** Pi 1.1 queries CSI 16t only at startup. Re-query after resize and periodically
 * for same-grid font/DPI changes. Do not read stdin or compete with Pi's parser:
 * changed replies reach Pi, which updates cell metrics and invalidates Markdown.
 */
export function watchCellSize(host: CellSizeHost): CellSizeWatcher {
	let stopped = false;
	let lastQuery = -Infinity;
	let report: ReturnType<CellSizeWatcher["lastReport"]>;
	const refresh = () => {
		if (stopped || !host.isActive() || Date.now() - lastQuery < 250) return;
		lastQuery = Date.now();
		host.write("\x1b[16t");
	};
	const offInput = host.onInput((data) => {
		if (stopped || !host.isActive()) return;
		// Pi's input buffer already assembles CSI sequences. Never swallow keys,
		// paste, partial sequences, focus reports, or an unrelated terminal reply.
		const match = /^\x1b\[6;(\d{1,5});(\d{1,5})t$/.exec(data);
		if (!match) return;
		const heightPx = Number(match[1]), widthPx = Number(match[2]);
		if (heightPx < 1 || widthPx < 1 || heightPx > 4096 || widthPx > 4096) return { consume: true };
		const cell = { widthPx, heightPx };
		report = { cell, at: Date.now() };
		const current = host.getCell();
		// Unchanged polls must not invalidate/re-transmit every formula image.
		if (current.widthPx === widthPx && current.heightPx === heightPx) return { consume: true };
		return undefined;
	});
	const offResize = host.onResize(refresh);
	const timer = setInterval(refresh, 2000);
	timer.unref();
	refresh();
	return {
		refresh,
		lastReport: () => report,
		stop: () => {
			if (stopped) return;
			stopped = true;
			clearInterval(timer);
			offInput();
			offResize();
		},
	};
}
