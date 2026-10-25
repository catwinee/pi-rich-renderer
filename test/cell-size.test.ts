import assert from "node:assert/strict";
import { test } from "node:test";
import type { TerminalInputHandler } from "@earendil-works/pi-coding-agent";
import { watchCellSize } from "../src/cell-size.ts";

function host() {
	let input: TerminalInputHandler | undefined;
	let resize: (() => void) | undefined;
	let active = true;
	let cell = { widthPx: 9, heightPx: 18 };
	const writes: string[] = [];
	const watcher = watchCellSize({
		isActive: () => active,
		write: (data) => { writes.push(data); },
		getCell: () => cell,
		onInput: (handler) => { input = handler; return () => { input = undefined; }; },
		onResize: (handler) => { resize = handler; return () => { resize = undefined; }; },
	});
	return { watcher, writes, setActive: (value: boolean) => { active = value; },
		setCell: (value: typeof cell) => { cell = value; },
		emit: (data: string) => input?.(data), resize: () => resize?.(),
		listeners: () => Number(!!input) + Number(!!resize) };
}

test("cell watcher refreshes after resize and same-grid changes, suppresses duplicate invalidation", (t) => {
	t.mock.timers.enable({ apis: ["setInterval", "Date"], now: 1000 });
	const h = host();
	try {
		assert.deepEqual(h.writes, ["\x1b[16t"]);
		assert.deepEqual(h.emit("\x1b[6;18;9t"), { consume: true });
		// A changed report is NOT consumed: Pi must update globals and invalidate
		// already-cached Markdown, even when the terminal's row/column count is fixed.
		assert.equal(h.emit("\x1b[6;63;31t"), undefined);
		h.setCell({ widthPx: 31, heightPx: 63 }); // model Pi's built-in response handler
		assert.deepEqual(h.emit("\x1b[6;63;31t"), { consume: true });
		assert.deepEqual(h.watcher.lastReport()?.cell, { widthPx: 31, heightPx: 63 });
		t.mock.timers.tick(300);
		h.resize();
		h.resize();
		assert.equal(h.writes.length, 2, "resize bursts are throttled");
		t.mock.timers.tick(1700);
		assert.equal(h.writes.length, 3, "same-grid changes still get periodic queries");
		h.setActive(false);
		t.mock.timers.tick(6000);
		h.resize();
		assert.equal(h.writes.length, 3, "no queries while another app owns the terminal");
		h.setActive(true);
		t.mock.timers.tick(2000);
		assert.equal(h.writes.length, 4);
	} finally { h.watcher.stop(); }
	assert.equal(h.listeners(), 0);
	h.watcher.stop(); h.watcher.refresh();
	t.mock.timers.tick(6000);
	assert.equal(h.writes.length, 4, "shutdown/reload leaves no active timer");
});

test("watcher preserves unrelated input and rejects invalid dimensions", () => {
	const h = host();
	try {
		for (const input of ["a", "中文", "\x1b[I", "\x1b[O", "\x1b[6;", "\x1b[4;1440;2160t", "x\x1b[6;63;31t", "\x1b[200~hello\x1b[201~"]) {
			assert.equal(h.emit(input), undefined);
		}
		for (const input of ["\x1b[6;0;31t", "\x1b[6;63;0t", "\x1b[6;99999;31t"]) assert.deepEqual(h.emit(input), { consume: true });
		assert.equal(h.watcher.lastReport(), undefined);
	} finally { h.watcher.stop(); }
});
