import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext, MarkdownTransformer } from "@earendil-works/pi-coding-agent";
import { setCapabilities } from "@earendil-works/pi-tui";
import extension from "../index.ts";

test("extension registers display-only hooks and leaves messages untouched in every mode", async () => {
	const root = await mkdtemp(join(tmpdir(), "rich-extension-test-"));
	const previous = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = root;
	try {
		const handlers = new Map<string, (event: unknown, ctx: ExtensionContext) => unknown>();
		const state: { transformer?: MarkdownTransformer } = {};
		const pi = {
			on: (name: string, handler: (event: unknown, ctx: ExtensionContext) => unknown) => { handlers.set(name, handler); return () => {}; },
			registerMarkdownTransformer: (transformer: MarkdownTransformer) => { state.transformer = transformer; },
		} as unknown as ExtensionAPI;
		extension(pi);
		assert.deepEqual([...handlers.keys()], ["session_start", "message_end", "session_shutdown"]);
		assert.ok(state.transformer);
		setCapabilities({ images: null, trueColor: true, hyperlinks: true });
		const message = Object.freeze({ role: "assistant", stopReason: "stop", content: Object.freeze([
			Object.freeze({ type: "thinking", thinking: "original reasoning", thinkingSignature: "signature" }),
			Object.freeze({ type: "text", text: "$$x$$" }),
		] as const) });
		for (const mode of ["print", "rpc", "json", "tui"] as const) {
			const render = mode === "tui" && process.env.PI_RICH_TEST_TEX === "1";
			setCapabilities({ images: render ? "kitty" : null, trueColor: true, hyperlinks: true });
			const notices: string[] = [];
			const ctx = {
				mode, cwd: root, isProjectTrusted: () => false,
				sessionManager: { getBranch: () => [] },
				ui: { notify: (text: string) => notices.push(text), theme: { appearance: "dark", getFgAnsi: () => "\x1b[38;2;230;237;243m" } },
			} as unknown as ExtensionContext;
			await handlers.get("session_start")!({}, ctx);
			assert.equal(await handlers.get("message_end")!({ message }, ctx), undefined);
			const shown = state.transformer!("$$x$$", { messageType: "assistant", isStreaming: false, availableWidth: 80 });
			if (render) assert.ok(shown.includes("\x1b_G"), notices.join("\n"));
			else assert.equal(shown, "$$x$$");
			assert.deepEqual(notices, []);
			assert.equal(state.transformer!("$$x$$", { messageType: "user", isStreaming: false, availableWidth: 80 }), "$$x$$");
			assert.equal(state.transformer!("$$x$$", { messageType: "assistant", isStreaming: true, availableWidth: 80 }), "$$x$$");
			if (render) {
				const bad = Object.freeze({ role: "assistant", stopReason: "stop", content: Object.freeze([
					Object.freeze({ type: "text", text: String.raw`$$\notARealCommand$$` }),
				]) });
				for (let attempt = 0; attempt < 2; attempt++) {
					assert.equal(await handlers.get("message_end")!({ message: bad }, ctx), undefined);
					assert.equal(state.transformer!(bad.content[0].text, { messageType: "assistant", isStreaming: false, availableWidth: 80 }), bad.content[0].text);
				}
				assert.equal(notices.length, 1, "failures warn once and leave messages intact");
			}
			await handlers.get("session_shutdown")!({}, ctx);
		}
		assert.equal(message.content[0].thinkingSignature, "signature");
		assert.equal(message.content[1].text, "$$x$$");
	} finally {
		if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previous;
		await rm(root, { recursive: true, force: true });
	}
});
