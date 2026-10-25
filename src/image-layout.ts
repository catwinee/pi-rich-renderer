import { PNG } from "pngjs";
import type { CellDimensions, ImageDimensions } from "@earendil-works/pi-tui";

const MAX_SIDE = 8192;
const MAX_PIXELS = 16_000_000;
const MAX_BYTES = 2 * 1024 * 1024;

export interface FormulaLayout {
	columns: number;
	rows: number;
	widthPx: number;
	heightPx: number;
	left: number;
	top: number;
}

/** Fit uniformly, then round the *transparent canvas*, never the formula, to cells. */
export function formulaLayout(source: ImageDimensions, cell: CellDimensions, maxColumns: number, displayScale: number): FormulaLayout | undefined {
	const values = [source.widthPx, source.heightPx, cell.widthPx, cell.heightPx, maxColumns, displayScale];
	if (values.some((v) => !Number.isFinite(v) || v <= 0)) return undefined;
	if (source.widthPx > MAX_SIDE || source.heightPx > MAX_SIDE || source.widthPx * source.heightPx > MAX_PIXELS) return undefined;
	const scale = Math.min(displayScale, Math.floor(maxColumns) * cell.widthPx / source.widthPx, 40 * cell.heightPx / source.heightPx);
	if (scale <= 0) return undefined;
	const columns = Math.max(1, Math.min(Math.floor(maxColumns), Math.ceil(source.widthPx * scale / cell.widthPx)));
	const rows = Math.max(1, Math.min(40, Math.ceil(source.heightPx * scale / cell.heightPx)));
	// Keep all source pixels (and therefore the configured TeX DPI). The terminal
	// scales this padded canvas to c/r cells. Rounding adds at most one source pixel.
	const widthPx = Math.max(source.widthPx, Math.round(columns * cell.widthPx / scale));
	const heightPx = Math.max(source.heightPx, Math.round(rows * cell.heightPx / scale));
	if (widthPx > MAX_SIDE || heightPx > MAX_SIDE || widthPx * heightPx > MAX_PIXELS) return undefined;
	return { columns, rows, widthPx, heightPx, left: Math.floor((widthPx - source.widthPx) / 2), top: Math.floor((heightPx - source.heightPx) / 2) };
}

/** Decode only our bounded TeX PNGs; failures keep Pi's ordinary math fallback. */
export function padFormula(png: string, source: ImageDimensions, layout: FormulaLayout): string | undefined {
	try {
		const input = Buffer.from(png, "base64");
		if (input.length > MAX_BYTES) return undefined;
		const decoded = PNG.sync.read(input, { checkCRC: true });
		if (decoded.width !== source.widthPx || decoded.height !== source.heightPx) return undefined;
		const canvas = new PNG({ width: layout.widthPx, height: layout.heightPx, fill: true });
		PNG.bitblt(decoded, canvas, 0, 0, decoded.width, decoded.height, layout.left, layout.top);
		const output = PNG.sync.write(canvas);
		return output.length <= MAX_BYTES ? output.toString("base64") : undefined;
	} catch { return undefined; }
}
