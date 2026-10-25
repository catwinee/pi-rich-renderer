import { PNG } from "pngjs";

/** Real CRC-valid RGBA fixture: padding now decodes pixels, not just the IHDR. */
export function fixturePng(width = 1, height = 1, noisy = false): Buffer {
	const png = new PNG({ width, height });
	let seed = 12345;
	for (let i = 0; i < png.data.length; i += 4) {
		seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
		png.data[i] = noisy ? seed & 255 : 230;
		png.data[i + 1] = noisy ? (seed >>> 8) & 255 : 237;
		png.data[i + 2] = noisy ? (seed >>> 16) & 255 : 243;
		png.data[i + 3] = 255;
	}
	return PNG.sync.write(png);
}
