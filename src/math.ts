export type Segment = { type: "text" | "math"; source: string };

const environments = /^(equation|align|gather|multline|flalign|alignat)\*?$/;
function escaped(text: string, at: number): boolean {
	let n = 0;
	while (at > 0 && text[--at] === "\\") n++;
	return n % 2 === 1;
}

/** Conservative scanner: preserve bytes; do not interpret code as mathematics. */
export function splitMath(text: string): Segment[] {
	const result: Segment[] = [];
	let start = 0;
	let i = 0;
	while (i < text.length) {
		// Fenced/indented code. Unclosed fences protect the remainder of the message.
		if (i === 0 || text[i - 1] === "\n") {
			const lineEnd = text.indexOf("\n", i);
			const line = text.slice(i, lineEnd < 0 ? text.length : lineEnd);
			const fence = /^ {0,3}(`{3,}|~{3,})/.exec(line);
			if (fence) {
				const close = new RegExp(`^ {0,3}${fence[1][0]}{${fence[1].length},}[ \\t]*$`, "gm");
				close.lastIndex = lineEnd < 0 ? text.length : lineEnd + 1;
				const match = close.exec(text);
				i = match ? match.index + match[0].length : text.length;
				continue;
			}
			// Block images cannot safely replace text inside tables, lists, quotes,
			// headings or link labels. Conservatively leave these lines to Pi.
			if (/^( {4}|\t)/.test(line) || /^ {0,3}(?:>|#{1,6}\s|[-+*]\s|\d+[.)]\s)/.test(line)
				|| line.includes("|") || /\[[^\n]*\]\(/.test(line) || /^ {0,3}</.test(line)) {
				i = lineEnd < 0 ? text.length : lineEnd + 1;
				continue;
			}
		}
		if (escaped(text, i)) { i++; continue; }
		if (text[i] === "`") {
			const ticks = /^`+/.exec(text.slice(i))![0];
			let end = i + ticks.length;
			while ((end = text.indexOf(ticks, end)) >= 0) {
				if (text[end - 1] !== "`" && text[end + ticks.length] !== "`") break;
				end += ticks.length;
			}
			i = end < 0 ? i + ticks.length : end + ticks.length;
			continue;
		}
		let opener = "";
		let closer = "";
		if (text.startsWith("$$", i)) { opener = closer = "$$"; }
		else if (text.startsWith("\\[", i)) { opener = "\\["; closer = "\\]"; }
		else if (text.startsWith("\\(", i)) { opener = "\\("; closer = "\\)"; }
		else if (text[i] === "$" && !/\s|\$/.test(text[i + 1] ?? " ")) { opener = closer = "$"; }
		else if (text.startsWith("\\begin{", i)) {
			const env = /^\\begin\{([^}]+)\}/.exec(text.slice(i));
			if (env && environments.test(env[1])) { opener = env[0]; closer = `\\end{${env[1]}}`; }
		}
		if (!opener) { i++; continue; }
		let end = i + opener.length;
		while ((end = text.indexOf(closer, end)) >= 0 && escaped(text, end)) end += closer.length;
		if (end < 0) { i += opener.length; continue; }
		const body = text.slice(i + opener.length, end);
		if (opener === "$" && (!body || /\n|\$/.test(body) || /\s$/.test(body) || /\d/.test(text[end + 1] ?? ""))) {
			i += opener.length;
			continue;
		}
		if (i > start) result.push({ type: "text", source: text.slice(start, i) });
		result.push({ type: "math", source: text.slice(i, end + closer.length) });
		i = end + closer.length;
		start = i;
	}
	if (start < text.length) result.push({ type: "text", source: text.slice(start) });
	return result;
}

export function latexDocument(source: string): string {
	let tex = source;
	let display = true;
	if (source.startsWith("$$")) tex = source.slice(2, -2);
	else if (source.startsWith("\\[")) tex = source.slice(2, -2);
	else if (source.startsWith("\\(")) { tex = source.slice(2, -2); display = false; }
	else if (source.startsWith("$")) { tex = source.slice(1, -1); display = false; }
	const body = source.startsWith("\\begin{") ? tex : `\\(${display ? "\\displaystyle " : ""}${tex}\\)`;
	return String.raw`\documentclass[12pt]{article}
\usepackage[active,tightpage]{preview}
\usepackage{amsmath,amssymb,mathtools,bm}
\setlength\PreviewBorder{2pt}
\pagestyle{empty}
\begin{document}
\begin{preview}
${body}
\end{preview}
\end{document}
`;
}
