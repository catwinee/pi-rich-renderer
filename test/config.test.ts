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
test("font-relative sizing is opt-in, bounded and trust-aware without reinterpreting imageScale", async () => {
	const root = await mkdtemp(join(tmpdir(), "rich-font-config-"));
	try {
		const agent = join(root, "agent"), cwd = join(root, "project");
		await mkdir(agent); await mkdir(join(cwd, ".pi"), { recursive: true });
		assert.equal((await loadConfig(agent, cwd, false)).imageSizing, "pixels");
		assert.equal((await loadConfig(agent, cwd, false)).fontScale, 1);
		await writeFile(join(agent, "settings.json"), JSON.stringify({ richRenderer: { imageSizing: "font", fontScale: 1.2, imageScale: 2 } }));
		await writeFile(join(cwd, ".pi/settings.json"), JSON.stringify({ richRenderer: { imageSizing: "pixels", fontScale: 0.8 } }));
		assert.equal((await loadConfig(agent, cwd, false)).imageSizing, "font");
		assert.equal((await loadConfig(agent, cwd, false)).fontScale, 1.2);
		assert.equal((await loadConfig(agent, cwd, false)).imageScale, 2);
		assert.equal((await loadConfig(agent, cwd, true)).imageSizing, "pixels");
		assert.equal((await loadConfig(agent, cwd, true)).fontScale, 0.8);
		for (const value of [null, "1", true, 0.49, 2.01]) {
			await writeFile(join(agent, "settings.json"), JSON.stringify({ richRenderer: { imageSizing: "invalid", fontScale: value } }));
			const config = await loadConfig(agent, cwd, false);
			assert.equal(config.fontScale, 1);
			assert.equal(config.imageSizing, "pixels");
		}
	} finally { await rm(root, { recursive: true, force: true }); }
});
test("alignment defaults to left; invalid values cannot inject terminal controls", async () => {
	const dir = await mkdtemp(join(tmpdir(), "rich-align-config-"));
	try {
		assert.equal((await loadConfig(dir, dir, false)).imageAlign, "left");
		assert.equal((await loadConfig(dir, dir, false)).outputPad, 1);
		for (const value of [null, 1, true, "right", "CENTER", "\x1b[20C", {}]) {
			await writeFile(join(dir, "settings.json"), JSON.stringify({ richRenderer: { imageAlign: value } }));
			assert.equal((await loadConfig(dir, dir, false)).imageAlign, "left");
		}
	} finally { await rm(dir, { recursive: true, force: true }); }
});
test("DPI settings are bounded, trust-aware and overridden only by a valid environment value", async () => {
	const root = await mkdtemp(join(tmpdir(), "rich-dpi-config-"));
	const previous = process.env.PI_RICH_RENDER_LATEX_DPI;
	try {
		delete process.env.PI_RICH_RENDER_LATEX_DPI;
		const agent = join(root, "agent"), cwd = join(root, "project");
		await mkdir(agent); await mkdir(join(cwd, ".pi"), { recursive: true });
		assert.equal((await loadConfig(agent, cwd, false)).dpi, 180);
		for (const value of [null, true, "300", 0, 71, 301]) {
			await writeFile(join(agent, "settings.json"), JSON.stringify({ richRenderer: { latexDpi: value } }));
			assert.equal((await loadConfig(agent, cwd, false)).dpi, 180);
		}
		await writeFile(join(agent, "settings.json"), JSON.stringify({ richRenderer: { latexDpi: 300 } }));
		await writeFile(join(cwd, ".pi/settings.json"), JSON.stringify({ richRenderer: { latexDpi: 240 } }));
		assert.equal((await loadConfig(agent, cwd, false)).dpi, 300);
		assert.equal((await loadConfig(agent, cwd, true)).dpi, 240);
		for (const value of ["", "invalid", "Infinity", "71", "301"]) {
			process.env.PI_RICH_RENDER_LATEX_DPI = value;
			assert.equal((await loadConfig(agent, cwd, true)).dpi, 240);
		}
		for (const value of ["72", "180", "300"]) {
			process.env.PI_RICH_RENDER_LATEX_DPI = value;
			assert.equal((await loadConfig(agent, cwd, true)).dpi, Number(value));
		}
	} finally {
		if (previous === undefined) delete process.env.PI_RICH_RENDER_LATEX_DPI;
		else process.env.PI_RICH_RENDER_LATEX_DPI = previous;
		await rm(root, { recursive: true, force: true });
	}
});
test("project settings require trust and resolve relative to current context", async () => {
	const root = await mkdtemp(join(tmpdir(), "rich-config-"));
	try {
		const agent = join(root, "agent"), cwd = join(root, "project");
		await mkdir(agent); await mkdir(join(cwd, ".pi"), { recursive: true });
		await writeFile(join(agent, "settings.json"), JSON.stringify({ richRenderer: { imageScale: 0.7, cacheTtlMs: 0, imageAlign: "center" }, outputPad: 0 }));
		await writeFile(join(cwd, ".pi/settings.json"), JSON.stringify({ richRenderer: { imageScale: 1.2, imageAlign: "left" }, terminal: { showImages: false }, outputPad: 1 }));
		assert.equal((await loadConfig(agent, cwd, false)).imageScale, 0.7);
		assert.equal((await loadConfig(agent, cwd, true)).imageScale, 1.2);
		assert.equal((await loadConfig(agent, cwd, true)).showImages, false);
		assert.equal((await loadConfig(agent, cwd, false)).cacheTtlMs, 0);
		assert.equal((await loadConfig(agent, cwd, false)).imageAlign, "center");
		assert.equal((await loadConfig(agent, cwd, true)).imageAlign, "left");
		assert.equal((await loadConfig(agent, cwd, false)).outputPad, 0);
		assert.equal((await loadConfig(agent, cwd, true)).outputPad, 1);
		await writeFile(join(cwd, ".pi/settings.json"), "broken JSON");
		assert.equal((await loadConfig(agent, cwd, true)).imageScale, 0.7);
	} finally { await rm(root, { recursive: true, force: true }); }
});
