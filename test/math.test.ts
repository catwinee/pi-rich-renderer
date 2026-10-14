import assert from "node:assert/strict";
import { test } from "node:test";
import { splitMath, latexDocument } from "../src/math.ts";

const formulas = (text: string) => splitMath(text).filter((s) => s.type === "math").map((s) => s.source);
test("recognizes delimiters and matching environments, preserving whitespace", () => {
	const input = "  $x$\n\n$$y$$ \\(z\\) \\[w\\] \\begin{align*}a&=b\\end{align*}\n";
	assert.equal(formulas(input).length, 5);
	assert.equal(splitMath(input).map((s) => s.source).join(""), input);
	assert.deepEqual(formulas("\\begin{align}x\\end{equation}"), []);
});
for (const code of [
	"`$x$`", "``a `$x$` b``", "```tex\n$$x$$\n```", "~~~~\n$$x$$\n~~~~",
	"````\n```\n$x$\n````", "```tex\n$x$", "    $x$\n", "\t$x$\n",
]) {
	test(`code remains untouched: ${JSON.stringify(code)}`, () => {
		assert.deepEqual(formulas(code), []);
		assert.equal(splitMath(code).map((s) => s.source).join(""), code);
	});
}
test("escaped delimiters, incomplete math, and common currency are not formulas", () => {
	for (const input of [String.raw`\$x\$`, "$x", "$$x", "cost $5 and $10", "$ x $", "$x\ny$"]) assert.deepEqual(formulas(input), [], input);
});
test("complex Markdown containers are conservatively left to Pi", () => {
	for (const input of ["> `$x$`", "- $x$", "1. $x$", "## $x$", "a | $x$", "[$x$](https://example.com)", "<div>$x$</div>"]) {
		assert.deepEqual(formulas(input), [], input);
	}
});
test("inline and display math retain their different TeX styles", () => {
	assert.match(latexDocument("$$x$$"), /\\displaystyle x/);
	assert.doesNotMatch(latexDocument("$x$"), /\\displaystyle/);
	assert.match(latexDocument(String.raw`\begin{align}x&=1\end{align}`), /\\begin\{align\}/);
});
