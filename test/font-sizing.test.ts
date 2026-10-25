import assert from "node:assert/strict";
import { test } from "node:test";
import { getCellDimensions, setCellDimensions, setCapabilities, Markdown } from "@earendil-works/pi-tui";
import { getMarkdownTheme, initTheme } from "@earendil-works/pi-coding-agent";
import { formulaLayout, formulaScale } from "../src/image-layout.ts";
import { DisplayStore, foreground, type Palette } from "../src/display.ts";
import { cacheKey } from "../src/cache.ts";
import { fixturePng } from "./png-fixture.ts";
import { compile } from "../src/sandbox.ts";
import { PNG } from "pngjs";

const sizing = { imageSizing: "font", fontScale: 1 } as const;
const theme: Palette = { appearance: "dark", getFgAnsi: () => "\x1b[38;2;230;237;243m" };
const source = "$$x$$";
const cells = [{ widthPx: 9, heightPx: 18 }, { widthPx: 18, heightPx: 36 }, { widthPx: 23, heightPx: 47 }, { widthPx: 31, heightPx: 63 }, { widthPx: 16, heightPx: 31 }];

function geometry(text: string) {
	return { columns: Number(/,c=(\d+)/.exec(text)?.[1]), rows: Number(/,r=(\d+)/.exec(text)?.[1]) };
}
function payload(text: string): string {
	return [...text.matchAll(/\x1b_G[^;]*;([A-Za-z0-9+/=]+)\x1b\\/g)].map((m) => m[1]).join("");
}

test("font mode maps the same TeX em to the same row fraction on every screen and DPI", () => {
	for (const cell of cells) for (const dpi of [72, 180, 300]) for (const fontScale of [0.5, 1, 1.5, 2]) {
		const scale = formulaScale(cell, dpi, 0.8, { ...sizing, fontScale });
		assert.ok(Math.abs((12 * dpi / 72.27) * scale / cell.heightPx - fontScale) < 1e-12);
		assert.equal(scale, formulaScale(cell, dpi, 2, { ...sizing, fontScale }), "legacy imageScale does not multiply fontScale");
	}
	assert.equal(formulaScale(cells[0], 300, 0.8, { imageSizing: "pixels", fontScale: 2 }), 0.8 * 180 / 300);
});

test("proportional density/zoom changes reuse source PNG and preserve layout at fixed grid width", () => {
	const original = getCellDimensions();
	setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
	try {
		for (const width of [2, 30, 100]) {
			const store = new DisplayStore();
			store.put(cacheKey(source, foreground(theme), 300), fixturePng(588, 52));
			let baseline: string | undefined;
			for (const factor of [1, 2, 3, 1]) {
				setCellDimensions({ widthPx: 9 * factor, heightPx: 18 * factor });
				const output = store.transform(source, width, theme, 2, 300, "center", 0, sizing).replace(/i=\d+/g, "i=ID");
				assert.ok(output.includes("\x1b_G"));
				if (baseline) assert.equal(output, baseline, "same image and geometry; no monitor-specific calibration");
				else baseline = output;
			}
		}
	} finally { setCellDimensions(original); }
});

test("same-width Markdown cache invalidation recomputes layout when cell aspect changes", () => {
	const original = getCellDimensions();
	initTheme("dark", false);
	setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
	try {
		const store = new DisplayStore();
		store.put(cacheKey(source, foreground(theme), 300), fixturePng(588, 52));
		const view = new Markdown(source, 0, 0, getMarkdownTheme(), undefined, {
			transform: (text, width) => store.transform(text, width, theme, 2, 300, "center", 0, sizing),
		});
		setCellDimensions({ widthPx: 9, heightPx: 18 });
		const a = geometry(view.render(100).join("\n"));
		setCellDimensions({ widthPx: 18, heightPx: 27 });
		view.invalidate(); // Pi's consumeCellSizeResponse does this on a changed report.
		const b = geometry(view.render(100).join("\n"));
		assert.ok(a.columns > b.columns && b.columns > 0);
		assert.equal(a.rows, b.rows);
	} finally { setCellDimensions(original); }
});

test("fractions and matrices grow naturally instead of each being normalized to one row", () => {
	const cell = cells[3];
	const scale = formulaScale(cell, 300, 2, sizing);
	const short = formulaLayout({ widthPx: 500, heightPx: 52 }, cell, 100, scale)!;
	const matrix = formulaLayout({ widthPx: 500, heightPx: 260 }, cell, 100, scale)!;
	assert.equal(short.columns, matrix.columns);
	assert.ok(matrix.rows > short.rows * 2);
});

test("real text-shaped formula has a stable glyph-to-row ratio across eDP/external cell sizes", { skip: !process.env.PI_RICH_TEST_TEX }, async () => {
	const png = await compile(String.raw`$$X_{\mathrm{text}} \in \mathbb{R}^{B\times L\times d_{\mathrm{model}}}$$`, foreground(theme), { dpi: 300, timeoutMs: 5000 });
	const original = getCellDimensions();
	setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
	try {
		const store = new DisplayStore();
		store.put(cacheKey(source, foreground(theme), 300), png);
		const ratios: number[] = [];
		for (const cell of cells) {
			setCellDimensions(cell);
			const output = store.transform(source, 100, theme, 2, 300, "center", 0, sizing);
			const raster = PNG.sync.read(Buffer.from(payload(output), "base64"));
			const { columns, rows } = geometry(output);
			let top = raster.height, bottom = -1;
			for (let y = 0; y < raster.height; y++) for (let x = 0; x < raster.width; x++) {
				if (raster.data[(y * raster.width + x) * 4 + 3] > 0) { top = Math.min(top, y); bottom = Math.max(bottom, y); }
			}
			assert.ok(bottom >= top);
			ratios.push((bottom - top + 1) * rows / raster.height);
			assert.ok(Math.abs((columns * cell.widthPx / raster.width) / (rows * cell.heightPx / raster.height) - 1) < 0.015);
		}
		assert.ok(Math.max(...ratios) - Math.min(...ratios) < 0.015, `glyph/row ratios: ${ratios}`);
	} finally { setCellDimensions(original); }
});
