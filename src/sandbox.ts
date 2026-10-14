import { execFile } from "node:child_process";
import { existsSync, lstatSync, readlinkSync } from "node:fs";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { latexDocument } from "./math.ts";

const exec = promisify(execFile);
export const MAX_PNG_BYTES = 2 * 1024 * 1024;
export interface RenderOptions { dpi: number; timeoutMs: number; signal?: AbortSignal }

/** Minimal Linux filesystem: no home, project, credentials, host /tmp, or network. */
export function sandboxArgs(dir: string, command: string, args: string[]): string[] {
	const mounts = ["--ro-bind", "/usr", "/usr"];
	for (const path of ["/bin", "/lib", "/lib64"]) {
		if (!existsSync(path)) continue;
		if (lstatSync(path).isSymbolicLink()) mounts.push("--symlink", readlinkSync(path), path);
		else mounts.push("--ro-bind", path, path);
	}
	for (const path of ["/etc/texmf", "/etc/fonts", "/var/lib/texmf", "/var/cache/texmf"]) {
		if (existsSync(path)) mounts.push("--ro-bind", path, path);
	}
	return [
		"--unshare-all", "--die-with-parent", "--new-session", "--cap-drop", "ALL",
		...mounts, "--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp",
		"--bind", dir, "/work", "--chdir", "/work", "--clearenv",
		"--setenv", "PATH", "/usr/bin:/bin", "--setenv", "HOME", "/tmp",
		"--setenv", "LANG", "C.UTF-8", "--setenv", "TEXMFVAR", "/tmp/texmf-var",
		"--setenv", "TEXMFCONFIG", "/tmp/texmf-config", "--setenv", "openin_any", "p",
		"--setenv", "openout_any", "p", "--setenv", "shell_escape", "f",
		"--setenv", "MKTEXFMT", "0", "--setenv", "MKTEXTFM", "0", "--setenv", "MKTEXPK", "0",
		"/usr/bin/prlimit", "--as=1073741824", "--cpu=10", "--fsize=16777216", "--nofile=64", "--",
		command, ...args,
	];
}

export async function runSandbox(dir: string, command: string, args: string[], options: RenderOptions): Promise<void> {
	if (process.platform !== "linux") throw new Error("Sandbox requires Linux and bubblewrap");
	await exec("/usr/bin/bwrap", sandboxArgs(dir, command, args), {
		timeout: options.timeoutMs, signal: options.signal, killSignal: "SIGKILL", maxBuffer: 1024 * 1024,
		// Do not leak agent credentials even to the sandbox launcher/dynamic loader.
		env: { PATH: "/usr/bin:/bin", LANG: "C.UTF-8" },
	});
}

export function validPng(png: Buffer): boolean {
	if (png.length < 33 || png.length > MAX_PNG_BYTES || !png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return false;
	if (png.toString("ascii", 12, 16) !== "IHDR") return false;
	const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
	return width > 0 && height > 0 && width <= 8192 && height <= 8192 && width * height <= 16000000;
}

export async function compile(source: string, foreground: string, options: RenderOptions): Promise<Buffer> {
	if (source.length > 8192) throw new Error("Formula exceeds 8192 characters");
	options.signal?.throwIfAborted();
	const dir = await mkdtemp(join(tmpdir(), "pi-rich-latex-"));
	try {
		await writeFile(join(dir, "input.tex"), latexDocument(source), { mode: 0o600 });
		await runSandbox(dir, "/usr/bin/latex", ["-no-shell-escape", "-halt-on-error", "-interaction=nonstopmode", "input.tex"], options);
		await runSandbox(dir, "/usr/bin/dvipng", ["--nogs", "--norawps", "--strict", "-T", "tight", "-D", String(options.dpi),
			"-bg", "Transparent", "-fg", foreground, "--truecolor", "-p", "1", "-l", "1", "-o", "output.png", "input.dvi"], options);
		if ((await stat(join(dir, "output.png"))).size > MAX_PNG_BYTES) throw new Error("PNG too large");
		const png = await readFile(join(dir, "output.png"));
		if (!validPng(png)) throw new Error("Invalid or oversized PNG");
		return png;
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}
