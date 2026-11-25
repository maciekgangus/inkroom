import { afterEach, describe, expect, test, vi } from "vitest";
import { sendChunk } from "./recording";

const URL = "/api/boards/b/recordings/r/chunk";
const chunk = new Blob(["abcd"]); // 4 bytes
const answer = (status: number, body?: unknown) =>
	new Response(body === undefined ? null : JSON.stringify(body), { status });

describe("sendChunk (R-112)", () => {
	const wait = vi.fn().mockResolvedValue(undefined);
	afterEach(() => {
		vi.unstubAllGlobals();
		wait.mockClear();
	});

	test("puts the chunk at its offset and returns where the next one starts", async () => {
		const fetchMock = vi.fn().mockResolvedValue(answer(204));
		vi.stubGlobal("fetch", fetchMock);
		expect(await sendChunk(URL, 10, chunk, wait)).toBe(14);
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe(`${URL}?offset=10`);
		expect(init.method).toBe("PUT");
		expect(init.body).toBe(chunk);
	});

	test("a chunk the server already holds counts as sent (its answer got lost)", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(answer(409, { size: 14 })),
		);
		expect(await sendChunk(URL, 10, chunk, wait)).toBe(14);
	});

	test("a file that is somewhere else than expected is an error, not a retry", async () => {
		const fetchMock = vi.fn().mockResolvedValue(answer(409, { size: 99 }));
		vi.stubGlobal("fetch", fetchMock);
		await expect(sendChunk(URL, 10, chunk, wait)).rejects.toThrow("rozjechało");
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	test("retries a network failure and a server error, then succeeds", async () => {
		const fetchMock = vi
			.fn()
			.mockRejectedValueOnce(new TypeError("offline"))
			.mockResolvedValueOnce(answer(503))
			.mockResolvedValueOnce(answer(204));
		vi.stubGlobal("fetch", fetchMock);
		expect(await sendChunk(URL, 0, chunk, wait)).toBe(4);
		expect(fetchMock).toHaveBeenCalledTimes(3);
		expect(wait.mock.calls.map((c) => c[0])).toEqual([500, 1000]);
	});

	test("gives up after a few tries", async () => {
		const fetchMock = vi.fn().mockRejectedValue(new TypeError("offline"));
		vi.stubGlobal("fetch", fetchMock);
		await expect(sendChunk(URL, 0, chunk, wait, 3)).rejects.toThrow(
			"Nie udało się wysłać",
		);
		expect(fetchMock).toHaveBeenCalledTimes(3);
	});

	test("does not retry what the server refused", async () => {
		const fetchMock = vi.fn().mockResolvedValue(answer(403));
		vi.stubGlobal("fetch", fetchMock);
		await expect(sendChunk(URL, 0, chunk, wait)).rejects.toThrow("403");
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
});
