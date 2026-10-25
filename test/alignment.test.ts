import assert from "node:assert/strict";
import { test } from "node:test";
import { getMarkdownTheme, initTheme } from "@earendil-works/pi-coding-agent";
import { getCellDimensions, Markdown, setCapabilities, setCellDimensions } from "@earendil-works/pi-tui";
// Test-only internal helpers from the pinned Pi version: verify the fullscreen
// clipping and cached re-placement paths, not merely our generated ANSI strings.
import { cropKittyImageLine, getKittyImagePlacement } from "../node_modules/@earendil-works/pi-tui/dist/terminal-image.js";
import { cacheKey } from "../src/cache.ts";
import { DisplayStore, foreground, type Palette } from "../src/display.ts";
import type { ImageAlign } from "../src/config.ts";
import { fixturePng } from "./png-fixture.ts";

const theme: Palette = { appearance: "dark", getFgAnsi: () => "\x1b[38;2;230;237;243m" };
const source = "Before\n\n$$x$$\n\nAfter";
function setup(widthPx = 600, heightPx = 300, chunked = false): DisplayStore {
	initTheme("dark", false);
	setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
	const png = fixturePng(widthPx, heightPx, chunked);
	const store = new DisplayStore();
	store.put(cacheKey("$$x$$", foreground(theme), 180), png);
	return store;
}
function markdown(store: DisplayStore, align: ImageAlign, pad: 0 | 1): Markdown {
	return new Markdown(source, pad, 0, getMarkdownTheme(), undefined, {
		transform: (text, width) => store.transform(text, width, theme, 1.5, 180, align, pad),
	});
}
function imageLine(lines: string[]): string {
	const line = lines.find((line) => line.includes("\x1b_G"));
	assert.ok(line);
	return line;
}
function checkCenter(line: string, totalWidth: number): number {
	const columns = Number(/(?:,|_)c=(\d+)/.exec(line)?.[1]);
	assert.ok(columns > 0);
	const offset = Math.floor((totalWidth - columns) / 2);
	assert.ok(offset >= 0);
	if (offset > 0) {
		assert.ok(line.startsWith(`\x1b[${offset}C`));
		assert.ok(line.endsWith(`\x1b[${offset}D`));
	} else assert.ok(line.startsWith("\x1b_G"));
	assert.ok(Math.abs(offset - (totalWidth - offset - columns)) <= 1);
	assert.ok(!line.includes("\n"));
	return offset;
}

test("centering follows resize, pane width, Markdown padding and cell dimensions", () => {
	const originalCell = getCellDimensions();
	try {
		for (const cell of [{ widthPx: 9, heightPx: 18 }, { widthPx: 18, heightPx: 36 }]) {
			setCellDimensions(cell);
			for (const pad of [0, 1] as const) {
				const view = markdown(setup(), "center", pad);
				// Reuse the component across resize, including a single-column image.
				for (const width of [120, 81, 40, 2 + pad * 2, 120]) {
					checkCenter(imageLine(view.render(width)), width);
				}
			}
		}
	} finally { setCellDimensions(originalCell); }
});

test("center changes placement only, not image dimensions, PNG, row reservation or text", () => {
	for (const [width, height] of [[600, 300], [20, 6000], [6000, 20]]) {
		const store = setup(width, height);
		const left = markdown(store, "left", 1).render(80);
		const center = markdown(store, "center", 1).render(80);
		const l = imageLine(left), c = imageLine(center);
		const offset = checkCenter(c, 80);
		const bare = offset > 0 ? c.slice(`\x1b[${offset}C`.length, -`\x1b[${offset}D`.length) : c;
		assert.equal(bare.replace(/i=\d+/g, "i=ID"), l.replace(/i=\d+/g, "i=ID"));
		assert.deepEqual(center.filter((line) => line !== c), left.filter((line) => line !== l));
		assert.ok(!l.startsWith("\x1b["), "left retains the old placement");
	}
});

test("fullscreen clipping and placement-only redraw retain offsets around chunked PNGs", () => {
	const line = imageLine(markdown(setup(600, 300, true), "center", 1).render(120));
	assert.ok((line.match(/\x1b_G/g)?.length ?? 0) > 1, "fixture uses chunked image transfer");
	checkCenter(line, 120);
	const cropped = cropKittyImageLine(line, 1, 2);
	checkCenter(cropped, 120);
	assert.match(cropped, /,r=2;/);
	for (const input of [line, cropped]) {
		const placement = getKittyImagePlacement(input);
		assert.ok(placement);
		checkCenter(placement.replacementLine, 120);
		assert.match(placement.replacementLine, /\x1b_Ga=p,/);
		assert.equal((placement.replacementLine.match(/\x1b_G/g) ?? []).length, 1);
	}
});
