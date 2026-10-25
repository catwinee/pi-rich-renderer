import type { Theme } from "@earendil-works/pi-coding-agent";
import { allocateImageId, getCapabilities, getCellDimensions, getImageDimensions, renderImage } from "@earendil-works/pi-tui";
import { cacheKey } from "./cache.ts";
import { DISPLAY_DPI, type ImageAlign } from "./config.ts";
import { splitMath } from "./math.ts";
import { formulaLayout, padFormula } from "./image-layout.ts";

export type Palette = Pick<Theme, "appearance" | "getFgAnsi">;
export function foreground(theme: Palette): string {
	const ansi = theme.getFgAnsi("text");
	const rgb = /38;2;(\d+);(\d+);(\d+)/.exec(ansi);
	let color: number[] = theme.appearance === "light" ? [24, 24, 24] : [230, 237, 243];
	if (rgb) color = rgb.slice(1).map(Number);
	else {
		const match = /38;5;(\d+)/.exec(ansi);
		if (match) {
			const n = Number(match[1]);
			if (n >= 232) color = Array(3).fill(8 + (n - 232) * 10);
			else if (n >= 16) {
				const cube = [0, 95, 135, 175, 215, 255];
				color = [cube[Math.floor((n - 16) / 36) % 6], cube[Math.floor((n - 16) / 6) % 6], cube[(n - 16) % 6]];
			}
		}
	}
	return `rgb ${color.map((v) => Math.max(0, Math.min(255, v)) / 255).join(" ")}`;
}

interface Prepared { png: string; bytes: number }
export class DisplayStore {
	private entries = new Map<string, Prepared>();
	private bytes = 0;
	private layouts = new Map<string, string | undefined>();
	private layoutBytes = 0;
	clear(): void { this.entries.clear(); this.bytes = 0; this.layouts.clear(); this.layoutBytes = 0; }
	has(key: string): boolean { return this.entries.has(key); }
	put(key: string, png: Buffer): void {
		// A replacement source must not reuse a padded version of the old PNG.
		this.layouts.clear();
		this.layoutBytes = 0;
		this.bytes -= this.entries.get(key)?.bytes ?? 0;
		this.entries.delete(key);
		const base64 = png.toString("base64");
		this.entries.set(key, { png: base64, bytes: base64.length });
		this.bytes += base64.length;
		while (this.entries.size > 64 || this.bytes > 8 * 1024 * 1024) {
			const oldest = this.entries.keys().next().value!;
			this.bytes -= this.entries.get(oldest)!.bytes;
			this.entries.delete(oldest);
		}
	}
	transform(markdown: string, width: number, theme: Palette, scale: number, dpi: number, align: ImageAlign = "left", outputPad: 0 | 1 = 0): string {
		if (getCapabilities().images !== "kitty" || width < 2 || markdown.length > 100000) return markdown;
		const fg = foreground(theme);
		return splitMath(markdown).map((segment) => {
			if (segment.type === "text") return segment.source;
			const key = cacheKey(segment.source, fg, dpi);
			const prepared = this.entries.get(key);
			if (!prepared) return segment.source;
			const dimensions = getImageDimensions(prepared.png, "image/png");
			if (!dimensions) return segment.source;
			const cell = getCellDimensions();
			// DPI controls sampling quality, not terminal size. Keep imageScale in
			// 180-DPI logical pixels so higher-resolution PNGs do not grow on screen.
			const displayScale = scale * DISPLAY_DPI / dpi;
			const layout = formulaLayout(dimensions, cell, Math.max(1, width - 2), displayScale);
			if (!layout) return segment.source;
			const layoutKey = `${key}:${layout.widthPx}:${layout.heightPx}`;
			if (!this.layouts.has(layoutKey)) {
				const padded = padFormula(prepared.png, dimensions, layout);
				this.layouts.set(layoutKey, padded);
				this.layoutBytes += padded?.length ?? 0;
				while (this.layouts.size > 64 || this.layoutBytes > 8 * 1024 * 1024) {
					const oldest = this.layouts.keys().next().value!;
					this.layoutBytes -= this.layouts.get(oldest)?.length ?? 0;
					this.layouts.delete(oldest);
				}
			}
			const padded = this.layouts.get(layoutKey);
			if (!padded) return segment.source;
			// Pass the padded dimensions through Pi's public API so fullscreen clipping
			// and placement-only redraw also use the correct source coordinates.
			const image = renderImage(padded, layout, {
				maxWidthCells: layout.columns,
				maxHeightCells: layout.rows,
				imageId: allocateImageId(),
				moveCursor: false,
			});
			if (!image) return segment.source;
			// Markdown skips its own margins for image lines. Include that inset when
			// centering; retain the original zero-inset behavior for left alignment.
			const offset = align === "center" ? outputPad + Math.max(0, Math.floor((width - image.columns) / 2)) : 0;
			// Relative motion survives Pi's fullscreen image cropping/re-placement.
			// C=1 leaves the cursor at the image origin; restore it for following text.
			const placed = offset > 0 ? `\x1b[${offset}C${image.sequence}\x1b[${offset}D` : image.sequence;
			// Keep the image in its own Markdown paragraph: Pi treats an image
			// paragraph as one terminal line. Otherwise embedded newlines bypass its
			// row accounting. Preserve blank rows in a separate non-image paragraph.
			// Escape ST's backslash so Markdown does not consume it as a hard break.
			const blocks = [placed.replaceAll("\\", "\\\\")];
			if (image.rows > 1) blocks.push(Array(image.rows - 1).fill("\x1b[0m").join("\n"));
			return `\n\n${blocks.join("\n\n")}\n\n`;
		}).join("");
	}
}
