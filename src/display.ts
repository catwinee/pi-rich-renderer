import type { Theme } from "@earendil-works/pi-coding-agent";
import { allocateImageId, getCapabilities, getCellDimensions, getImageDimensions, renderImage } from "@earendil-works/pi-tui";
import { cacheKey } from "./cache.ts";
import { DISPLAY_DPI, type ImageAlign } from "./config.ts";
import { splitMath } from "./math.ts";

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
	clear(): void { this.entries.clear(); this.bytes = 0; }
	has(key: string): boolean { return this.entries.has(key); }
	put(key: string, png: Buffer): void {
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
			// Markdown already caches output by width. Allocate a distinct placement per
			// occurrence rather than sharing one Kitty image ID across the transcript.
			const image = renderImage(prepared.png, dimensions, {
				// Match Image.render's two-column width allowance to preserve sizing.
				maxWidthCells: Math.max(1, Math.min(width - 2, Math.ceil(dimensions.widthPx / cell.widthPx * displayScale))),
				maxHeightCells: Math.max(1, Math.min(40, Math.ceil(dimensions.heightPx / cell.heightPx * displayScale))),
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
