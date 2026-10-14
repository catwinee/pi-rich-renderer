import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bounded, loadConfig } from "../src/config.ts";

test("rejects coercion, NaN, infinity and out-of-range values", () => {
	for (const value of [null, true, "1", NaN, Infinity, -1, 100]) assert.equal(bounded(value, 0.5, 0.1, 2), 0.5);
	assert.equal(bounded(1, 0.5, 0.1, 2), 1);
});
test("project settings require trust and resolve relative to current context", async () => {
	const root = await mkdtemp(join(tmpdir(), "rich-config-"));
	try {
		const agent = join(root, "agent"), cwd = join(root, "project");
		await mkdir(agent); await mkdir(join(cwd, ".pi"), { recursive: true });
		await writeFile(join(agent, "settings.json"), JSON.stringify({ richRenderer: { imageScale: 0.7, cacheTtlMs: 0 } }));
		await writeFile(join(cwd, ".pi/settings.json"), JSON.stringify({ richRenderer: { imageScale: 1.2 }, terminal: { showImages: false } }));
		assert.equal((await loadConfig(agent, cwd, false)).imageScale, 0.7);
		assert.equal((await loadConfig(agent, cwd, true)).imageScale, 1.2);
		assert.equal((await loadConfig(agent, cwd, true)).showImages, false);
		assert.equal((await loadConfig(agent, cwd, false)).cacheTtlMs, 0);
		await writeFile(join(cwd, ".pi/settings.json"), "broken JSON");
		assert.equal((await loadConfig(agent, cwd, true)).imageScale, 0.7);
	} finally { await rm(root, { recursive: true, force: true }); }
});
