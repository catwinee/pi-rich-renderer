import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, readFile, symlink, utimes, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RenderCache, cacheKey } from "../src/cache.ts";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
test("cache identity includes color/DPI; hits need no TeX; symlinks are never read", async () => {
	const dir = await mkdtemp(join(tmpdir(), "rich-cache-unit-"));
	try {
		const cache = new RenderCache(dir);
		const key = cacheKey("$x$", "rgb 1 1 1", 180);
		assert.notEqual(key, cacheKey("$x$", "rgb 0 0 0", 180));
		assert.notEqual(key, cacheKey("$x$", "rgb 1 1 1", 200));
		await writeFile(join(dir, `${key}.png`), png);
		assert.deepEqual(await cache.render("$x$", "rgb 1 1 1", { dpi: 180, timeoutMs: 1 }), png);
		const large = "x".repeat(8193);
		const secret = join(dir, "private.png");
		await writeFile(secret, png);
		await symlink(secret, join(dir, `${cacheKey(large, "rgb 1 1 1", 180)}.png`));
		// If symlink reads were allowed this would return the target PNG. Instead
		// it reaches compile's size guard, without spawning an external process.
		await assert.rejects(cache.render(large, "rgb 1 1 1", { dpi: 180, timeoutMs: 1 }), /8192/);
		assert.deepEqual(await readFile(secret), png);
	} finally { await rm(dir, { recursive: true, force: true }); }
});
test("cleanup expires only owned regular cache files and honors zero TTL", async () => {
	const dir = await mkdtemp(join(tmpdir(), "rich-cache-expiry-"));
	try {
		const name = `${cacheKey("$x$", "rgb 1 1 1", 180)}.png`;
		await writeFile(join(dir, name), png);
		await writeFile(join(dir, "unrelated.png"), png);
		await utimes(join(dir, name), new Date(0), new Date(0));
		const cache = new RenderCache(dir);
		await cache.cleanup(0);
		assert.ok((await readdir(dir)).includes(name));
		await cache.cleanup(1);
		assert.deepEqual(await readdir(dir), ["unrelated.png"]);
	} finally { await rm(dir, { recursive: true, force: true }); }
});
