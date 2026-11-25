import { afterEach, describe, expect, test, vi } from "vitest";
import { storePreviewPicture } from "./api";

// The page's CSP has no data: in connect-src, so the picture must not be read with fetch(data:)
// (R-088): only the PUT to the server goes over the network.
describe("storePreviewPicture", () => {
	afterEach(() => vi.unstubAllGlobals());

	test("sends the PNG bytes of a data URL without fetching the data URL", async () => {
		const calls: [string, RequestInit | undefined][] = [];
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url: string, init?: RequestInit) => {
				calls.push([url, init]);
				if (url.startsWith("data:")) throw new TypeError("blocked by CSP");
				return new Response(null, { status: 204 });
			}),
		);
		await storePreviewPicture("b1", "t1", "data:image/png;base64,iVBORw0K");
		expect(calls).toHaveLength(1);
		const [url, init] = calls[0];
		expect(url).toBe("/api/boards/b1/preview.png?tag=t1");
		expect(init?.method).toBe("PUT");
		const body = init?.body as Blob;
		expect(body.type).toBe("image/png");
		expect([...new Uint8Array(await body.arrayBuffer())]).toEqual([
			0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a,
		]);
	});
});
