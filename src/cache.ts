import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, readdir, rename, rm, lstat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { compile, MAX_PNG_BYTES, validPng, type RenderOptions } from "./sandbox.ts";

export function cacheKey(source: string, foreground: string, dpi: number): string {
	return createHash("sha256").update(JSON.stringify(["sandbox-latex-v2", source, foreground, dpi])).digest("hex");
}
export class RenderCache {
	constructor(readonly dir: string) {}
	async render(source: string, foreground: string, options: RenderOptions): Promise<Buffer> {
		options.signal?.throwIfAborted();
		await mkdir(this.dir, { recursive: true, mode: 0o700 });
		const path = join(this.dir, `${cacheKey(source, foreground, options.dpi)}.png`);
		try {
			const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
			try {
				const info = await file.stat();
				if (info.isFile() && info.size <= MAX_PNG_BYTES) {
					const png = await file.readFile();
					if (validPng(png)) return png;
				}
			} finally { await file.close(); }
		} catch { /* Cache miss, corruption, or symlink: compile in isolation. */ }
		const png = await compile(source, foreground, options);
		const temporary = join(this.dir, `${randomUUID()}.tmp`);
		try {
			await writeFile(temporary, png, { flag: "wx", mode: 0o600 });
			await rename(temporary, path);
		} finally { await rm(temporary, { force: true }); }
		return png;
	}
	async cleanup(ttlMs: number): Promise<void> {
		const now = Date.now();
		const entries: { path: string; size: number; mtimeMs: number }[] = [];
		for (const name of await readdir(this.dir).catch(() => [])) {
			if (!/^[a-f0-9]{64}\.png$/.test(name)) continue;
			const path = join(this.dir, name);
			const info = await lstat(path).catch(() => undefined);
			if (!info?.isFile()) continue;
			if (ttlMs > 0 && now - info.mtimeMs > ttlMs) await rm(path, { force: true });
			else entries.push({ path, size: info.size, mtimeMs: info.mtimeMs });
		}
		let bytes = entries.reduce((sum, entry) => sum + entry.size, 0);
		for (const entry of entries.sort((a, b) => a.mtimeMs - b.mtimeMs)) {
			if (bytes <= 64 * 1024 * 1024) break;
			await rm(entry.path, { force: true });
			bytes -= entry.size;
		}
	}
}
