import { readFile } from "node:fs/promises";
import { join } from "node:path";

// Preserve the original 180-DPI display size while raster quality changes.
export const DISPLAY_DPI = 180;
export type ImageAlign = "left" | "center";
export type ImageSizing = "pixels" | "font";
export interface Config {
	imageSizing: ImageSizing;
	fontScale: number;
	imageScale: number;
	imageAlign: ImageAlign;
	outputPad: 0 | 1;
	cacheTtlMs: number;
	timeoutMs: number;
	dpi: number;
	showImages: boolean;
}
export function bounded(value: unknown, fallback: number, min: number, max: number): number {
	return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max ? value : fallback;
}
async function settings(path: string): Promise<Record<string, unknown>> {
	try {
		const value: unknown = JSON.parse(await readFile(path, "utf8"));
		return object(value);
	} catch { return {}; }
}
function object(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export async function loadConfig(agentDir: string, cwd: string, trusted: boolean): Promise<Config> {
	const global = await settings(join(agentDir, "settings.json"));
	const project = trusted ? await settings(join(cwd, ".pi", "settings.json")) : {};
	const options = { ...object(global.richRenderer), ...object(project.richRenderer) };
	const terminal = { ...object(global.terminal), ...object(project.terminal) };
	return {
		// Opt in explicitly: existing imageScale settings retain their old meaning.
		imageSizing: options.imageSizing === "font" ? "font" : "pixels",
		fontScale: bounded(options.fontScale, 1, 0.5, 2),
		imageScale: bounded(options.imageScale, 0.5, 0.1, 2),
		imageAlign: options.imageAlign === "center" ? "center" : "left",
		outputPad: (project.outputPad ?? global.outputPad) === 0 ? 0 : 1,
		cacheTtlMs: bounded(options.cacheTtlMs, 604800000, 0, 31536000000),
		timeoutMs: bounded(Number(process.env.PI_RICH_RENDER_TIMEOUT_MS), 5000, 100, 15000),
		dpi: bounded(Number(process.env.PI_RICH_RENDER_LATEX_DPI), bounded(options.latexDpi, DISPLAY_DPI, 72, 300), 72, 300),
		showImages: terminal.showImages !== false,
	};
}
