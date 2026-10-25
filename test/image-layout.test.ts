import assert from "node:assert/strict";
import { test } from "node:test";
import { PNG } from "pngjs";
import { getCellDimensions, setCellDimensions, setCapabilities } from "@earendil-works/pi-tui";
import { getKittyImageMetadata } from "../node_modules/@earendil-works/pi-tui/dist/terminal-image.js";
import { formulaLayout, padFormula } from "../src/image-layout.ts";
import { DisplayStore, foreground, type Palette } from "../src/display.ts";
import { cacheKey } from "../src/cache.ts";
import { compile } from "../src/sandbox.ts";
import { fixturePng } from "./png-fixture.ts";

const theme: Palette = { appearance: "dark", getFgAnsi: () => "\x1b[38;2;230;237;243m" };
const source = "$$x$$";

function verify(png: Buffer, cell = { widthPx: 31, heightPx: 63 }, width = 87, scale = 0.8, dpi = 300) {
	const originalCell = getCellDimensions();
	try {
		setCellDimensions(cell);
		setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
		const store = new DisplayStore();
		store.put(cacheKey(source, foreground(theme), dpi), png);
		const output = store.transform(source, width, theme, scale, dpi);
		const chunks = [...output.matchAll(/\x1b_G[^;]*;([A-Za-z0-9+/=]+)\x1b\\/g)];
		assert.ok(chunks.length);
		const padded = PNG.sync.read(Buffer.from(chunks.map((m) => m[1]).join(""), "base64"));
		const columns = Number(/,c=(\d+)/.exec(output)?.[1]);
		const rows = Number(/,r=(\d+)/.exec(output)?.[1]);
		const horizontalScale = columns * cell.widthPx / padded.width;
		const verticalScale = rows * cell.heightPx / padded.height;
		// At low DPI a one-pixel padding roundoff can be visible on a very thin
		// canvas. The eDP fixture below separately enforces a strict 1% bound.
		assert.ok(Math.abs(horizontalScale / verticalScale - 1) < Math.max(0.012, 1 / Math.min(padded.width, padded.height)), `nonuniform scale: ${horizontalScale} vs ${verticalScale}`);
		assert.ok(columns <= Math.max(1, width - 2) && rows <= 40);
		assert.ok(horizontalScale <= scale * 180 / dpi * (1 + 1 / padded.width), "small formulas must not grow to fill a cell");
		const decoded = PNG.sync.read(png);
		const left = Math.floor((padded.width - decoded.width) / 2);
		const top = Math.floor((padded.height - decoded.height) / 2);
		// Verify source pixels were copied exactly, and all extra pixels are transparent.
		for (let y = 0; y < padded.height; y++) {
			const row = padded.data.subarray(y * padded.width * 4, (y + 1) * padded.width * 4);
			if (y < top || y >= top + decoded.height) assert.ok(row.every((v) => v === 0));
			else {
				assert.ok(row.subarray(0, left * 4).every((v) => v === 0));
				assert.deepEqual(row.subarray(left * 4, (left + decoded.width) * 4), decoded.data.subarray((y - top) * decoded.width * 4, (y - top + 1) * decoded.width * 4));
				assert.ok(row.subarray((left + decoded.width) * 4).every((v) => v === 0));
			}
		}
		const metadata = getKittyImageMetadata(output);
		assert.equal(metadata?.widthPx, padded.width);
		assert.equal(metadata?.heightPx, padded.height);
		return { columns, rows, padded, distortion: horizontalScale / verticalScale };
	} finally { setCellDimensions(originalCell); }
}

test("eDP short formulas retain aspect ratio instead of stretching to one full row", () => {
	for (const [w, h] of [[588, 52], [484, 67], [100, 100]]) {
		for (const cell of [{ widthPx: 31, heightPx: 63 }, { widthPx: 23, heightPx: 47 }, { widthPx: 9, heightPx: 18 }]) {
			verify(fixturePng(w, h), cell);
		}
	}
	const result = verify(fixturePng(588, 52));
	assert.ok(Math.abs(result.distortion - 1) < 0.01);
	assert.equal(result.columns, 10);
	assert.equal(result.rows, 1);
	assert.ok(result.padded.height > 52, "the unused row height belongs to padding, not stretched glyphs");
});

test("narrow/tall formulas, DPI changes and resize retain uniform pixel scale", () => {
	for (const width of [2, 20, 80]) {
		for (const [w, h] of [[600, 30], [30, 600], [600, 300]]) {
			for (const dpi of [72, 180, 300]) verify(fixturePng(w * dpi / 180, h * dpi / 180), undefined, width, 0.8, dpi);
		}
	}
});

test("invalid or excessive canvases fail closed and corrupt PNGs keep source text", () => {
	const cell = { widthPx: 31, heightPx: 63 };
	assert.equal(formulaLayout({ widthPx: 6000, heightPx: 30 }, cell, 1, 0.48), undefined);
	for (const widthPx of [0, -1, Infinity, NaN, 8193]) assert.equal(formulaLayout({ widthPx, heightPx: 50 }, cell, 80, 0.48), undefined);
	const dim = { widthPx: 100, heightPx: 50 };
	const layout = formulaLayout(dim, cell, 80, 0.48)!;
	assert.equal(padFormula("bad", dim, layout), undefined);
	setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
	const store = new DisplayStore();
	const broken = fixturePng(100, 50);
	broken[broken.length - 1] ^= 1;
	store.put(cacheKey(source, foreground(theme), 300), broken);
	assert.equal(store.transform(source, 80, theme, 0.8, 300), source);
	store.put(cacheKey(source, foreground(theme), 300), fixturePng(100, 50));
	assert.ok(store.transform(source, 80, theme, 0.8, 300).includes("\x1b_G"), "replacing source invalidates cached failure");
	store.clear();
	assert.equal(store.transform(source, 80, theme, 0.8, 300), source);
});

test("real screenshot formula passes TeX → transparent padding → Kitty geometry", { skip: !process.env.PI_RICH_TEST_TEX }, async () => {
	const png = await compile(String.raw`z_T \to z_{t_1} \to z_{t_2} \to \cdots \to z_0`, foreground(theme), { dpi: 300, timeoutMs: 5000 });
	verify(png);
});
