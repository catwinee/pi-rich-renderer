import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compile, runSandbox, sandboxArgs, validPng } from "../src/sandbox.ts";
import { RenderCache, cacheKey } from "../src/cache.ts";

const integration = process.env.PI_RICH_TEST_TEX === "1";
const options = { dpi: 180, timeoutMs: 5000 };
test("sandbox is fail-closed, isolated, with resource limits and clean environment", () => {
	const args = sandboxArgs("/tmp/work", "/usr/bin/latex", ["input.tex"]);
	for (const arg of ["--unshare-all", "--clearenv", "--die-with-parent", "--as=1073741824", "--cpu=10", "--fsize=16777216"]) assert.ok(args.includes(arg));
	assert.ok(!args.includes("/home"));
	assert.ok(!args.includes("--ro-bind-try"));
});
test("oversized input and cancellation fail before creating a process", async () => {
	await assert.rejects(compile("x".repeat(8193), "rgb 1 1 1", options), /8192/);
	await assert.rejects(compile("$x$", "rgb 1 1 1", { ...options, signal: AbortSignal.abort() }), /abort/i);
	assert.equal(validPng(Buffer.from("not an image")), false);
});
test("real TeX produces a valid PNG and cache hit avoids recompilation", { skip: !integration }, async () => {
	const dir = await mkdtemp(join(tmpdir(), "rich-cache-test-"));
	try {
		const cache = new RenderCache(dir);
		const source = String.raw`$$\frac{1}{\sqrt{d}}\begin{bmatrix}a&b\\c&d\end{bmatrix}$$`;
		const png = await cache.render(source, "rgb 1 1 1", options);
		assert.ok(validPng(png));
		// A 1ms compile cannot succeed: matching PNG proves the disk cache was used.
		assert.deepEqual(await cache.render(source, "rgb 1 1 1", { ...options, timeoutMs: 1 }), png);
		await writeFile(join(dir, `${cacheKey(source, "rgb 1 1 1", options.dpi)}.png`), "corrupt");
		assert.ok(validPng(await cache.render(source, "rgb 1 1 1", options)));
	} finally { await rm(dir, { recursive: true, force: true }); }
});
test("sandbox hides host files/credentials and enforces timeout", { skip: !integration }, async () => {
	const dir = await mkdtemp(join(tmpdir(), "rich-isolation-test-"));
	const outside = await mkdtemp(join(tmpdir(), "rich-secret-test-"));
	const previous = process.env.PI_TEST_SECRET;
	process.env.PI_TEST_SECRET = "must-not-leak";
	try {
		await writeFile(join(outside, "secret"), "TOP_SECRET");
		await runSandbox(dir, "/usr/bin/sh", ["-c", `test ! -e '${outside}/secret' && test ! -e /home && test -z "$PI_TEST_SECRET"`], options);
		await assert.rejects(runSandbox(dir, "/usr/bin/sleep", ["10"], { ...options, timeoutMs: 100 }));
		await assert.rejects(compile(`$$\\input{${outside}/secret}$$`, "rgb 1 1 1", options));
	} finally {
		if (previous === undefined) delete process.env.PI_TEST_SECRET;
		else process.env.PI_TEST_SECRET = previous;
		await rm(dir, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true });
	}
});
