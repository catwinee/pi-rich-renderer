import assert from "node:assert/strict";
import { test } from "node:test";
import { getMarkdownTheme, initTheme } from "@earendil-works/pi-coding-agent";
import { getCellDimensions, Markdown, setCapabilities, setCellDimensions, visibleWidth } from "@earendil-works/pi-tui";
import { DisplayStore, foreground, type Palette } from "../src/display.ts";
const isImageLine = (line: string) => line.includes("\x1b_G");
import { cacheKey } from "../src/cache.ts";

import { fixturePng } from "./png-fixture.ts";
const png = fixturePng();
const theme: Palette = { appearance: "dark", getFgAnsi: () => "\x1b[38;2;230;237;243m" };

test("display-only replacement survives native Markdown and narrow/resize layouts", () => {
	initTheme("dark", false);
	setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
	const store = new DisplayStore();
	store.put(cacheKey("$$x$$", foreground(theme), 180), png);
	const original = "Before\n\n$$x$$\n\nAfter";
	for (const width of [80, 20, 2, 100]) {
		const markdown = new Markdown(original, 0, 0, getMarkdownTheme(), undefined, {
			transform: (text, available) => store.transform(text, available, theme, 0.5, 180),
		});
		const lines = markdown.render(width);
		assert.ok(lines.some(isImageLine), `image survives Markdown at width ${width}`);
		assert.ok(lines.filter(isImageLine).every((line) => line.endsWith("\x1b\\") && !line.includes("\n")), "Kitty ST terminator and row boundaries survive Markdown");
		assert.ok(lines.every((line) => isImageLine(line) || visibleWidth(line) <= width));
	}
	assert.equal(store.transform(original, 1, theme, 0.5, 180), original);
	assert.equal(original, "Before\n\n$$x$$\n\nAfter");
});
test("multi-row images reserve height and repeated formulas get unique placements", () => {
	initTheme("dark", false);
	setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
	const store = new DisplayStore();
	const large = fixturePng(600, 300);
	store.put(cacheKey("$$x$$", foreground(theme), 180), large);
	const raw = store.transform("Before\n\n$$x$$\n\nAfter\n\n$$x$$", 80, theme, 0.5, 180);
	const lines = new Markdown(raw, 0, 0, getMarkdownTheme()).render(80);
	const imageRow = lines.findIndex(isImageLine);
	assert.ok(lines.findIndex((line) => line.includes("After")) - imageRow >= 9);
	const ids = lines.filter(isImageLine).map((line) => /,i=(\d+)/.exec(line)?.[1]);
	assert.ok(lines.every((line) => !line.includes("\n")));
	assert.equal(ids.length, 2);
	assert.ok(ids.every(Boolean));
	assert.notEqual(ids[0], ids[1]);
});
test("DPI changes source resolution with placement and reservation stable within cell rounding", () => {
	initTheme("dark", false);
	setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
	const originalCell = getCellDimensions();
	try {
		for (const cell of [{ widthPx: 9, heightPx: 18 }, { widthPx: 18, heightPx: 36 }]) {
			setCellDimensions(cell);
			for (const width of [2, 20, 80, 120]) {
				for (const [w, h] of [[600, 300], [600, 30], [30, 600]]) {
					for (const scale of [0.5, 1.0, 1.5]) {
						let baseline: { columns: number; rows: number; offset: number; length: number } | undefined;
						for (const dpi of [180, 72, 240, 300]) {
							const store = new DisplayStore();
							const raster = fixturePng(w * dpi / 180, h * dpi / 180);
							store.put(cacheKey("$$x$$", foreground(theme), dpi), raster);
							const raw = store.transform("Before\n\n$$x$$\n\nAfter", width, theme, scale, dpi, "center", 1);
							const lines = new Markdown(raw, 0, 0, getMarkdownTheme()).render(width);
							assert.ok(lines.some(isImageLine));
							const image = lines.find(isImageLine)!;
							const layout = {
								columns: Number(/,c=(\d+)/.exec(image)?.[1]),
								rows: Number(/,r=(\d+)/.exec(image)?.[1]),
								offset: Number(/^\x1b\[(\d+)C/.exec(image)?.[1] ?? 0),
								length: lines.length,
							};
							// Integer PNG padding can move Pi's aspect-optimizing cell rounding
							// across one boundary, especially for very thin, low-DPI images.
							if (baseline) {
								assert.ok(Math.abs(layout.columns - baseline.columns) <= 1);
								assert.ok(Math.abs(layout.rows - baseline.rows) <= 1);
								assert.ok(Math.abs(layout.offset - baseline.offset) <= 1);
								assert.equal(layout.length - baseline.length, layout.rows - baseline.rows);
							} else baseline = layout;
						}
					}
				}
			}
		}
	} finally { setCellDimensions(originalCell); }
});
test("unsupported terminals, missing cache and changed foreground preserve exact source", () => {
	const store = new DisplayStore();
	const original = "$$x$$";
	store.put(cacheKey(original, foreground(theme), 180), png);
	setCapabilities({ images: null, trueColor: true, hyperlinks: true });
	assert.equal(store.transform(original, 80, theme, 0.5, 180), original);
	setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
	const light: Palette = { appearance: "light", getFgAnsi: () => "\x1b[38;2;0;0;0m" };
	assert.equal(store.transform(original, 80, light, 0.5, 180), original);
	assert.equal(store.transform("$$missing$$", 80, theme, 0.5, 180), "$$missing$$");
});
