import { afterEach, describe, expect, test, vi } from "vitest";
import { PartCutter, uploadPart } from "./recording";

const blob = (n: number, ch = "x") => new Blob([ch.repeat(n)]);
const text = (b: Blob) => b.text();
const answer = (status: number) => new Response(null, { status });

describe("PartCutter (R-094)", () => {
	test("hands out parts of exactly the part size and keeps the rest", async () => {
		const c = new PartCutter(10);
		expect(c.push(blob(4, "a"))).toEqual([]);
		const parts = c.push(blob(27, "b")); // 31 in all: three parts of 10 and 1 left
		expect(parts.map((p) => p.size)).toEqual([10, 10, 10]);
		expect(await text(parts[0])).toBe("aaaabbbbbb");
		expect(await text(parts[1])).toBe("bbbbbbbbbb");
		const rest = c.rest();
		expect(rest?.size).toBe(1);
		expect(await text(rest as Blob)).toBe("b");
	});

	test("a chunk that completes a part exactly leaves nothing", () => {
		const c = new PartCutter(10);
		expect(c.push(blob(10)).map((p) => p.size)).toEqual([10]);
		expect(c.rest()).toBeNull();
	});

	test("nothing recorded, nothing to send", () => {
		expect(new PartCutter(10).rest()).toBeNull();
	});
});

describe("uploadPart (R-094)", () => {
	const wait = vi.fn().mockResolvedValue(undefined);
	const part = blob(4);
	const address = () =>
		Promise.resolve({ url: "https://bucket.test/p?n=1", method: "PUT" });
	afterEach(() => {
		vi.unstubAllGlobals();
		wait.mockClear();
	});

	test("sends the part to the address it was given", async () => {
		const fetchMock = vi.fn().mockResolvedValue(answer(200));
		vi.stubGlobal("fetch", fetchMock);
		await uploadPart(address, part, wait);
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe("https://bucket.test/p?n=1");
		expect(init.method).toBe("PUT");
		expect(init.body).toBe(part);
		// No header of ours: the signed request of the bucket must reach it as signed.
		expect(init.headers).toBeUndefined();
	});

	test("asks for a new address on every try (a signed one may have run out)", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(answer(403))
			.mockResolvedValueOnce(answer(200));
		vi.stubGlobal("fetch", fetchMock);
		const addr = vi.fn(address);
		await uploadPart(addr, part, wait);
		expect(addr).toHaveBeenCalledTimes(2);
	});

	test("retries a network failure and a server error, then succeeds", async () => {
		const fetchMock = vi
			.fn()
			.mockRejectedValueOnce(new TypeError("offline"))
			.mockResolvedValueOnce(answer(503))
			.mockResolvedValueOnce(answer(200));
		vi.stubGlobal("fetch", fetchMock);
		await uploadPart(address, part, wait);
		expect(fetchMock).toHaveBeenCalledTimes(3);
		expect(wait.mock.calls.map((c) => c[0])).toEqual([500, 1000]);
	});

	test("gives up after a few tries", async () => {
		const fetchMock = vi.fn().mockRejectedValue(new TypeError("offline"));
		vi.stubGlobal("fetch", fetchMock);
		await expect(uploadPart(address, part, wait, 3)).rejects.toThrow(
			"Nie udało się wysłać",
		);
		expect(fetchMock).toHaveBeenCalledTimes(3);
	});

	test("does not retry what the store refused for good", async () => {
		const fetchMock = vi.fn().mockResolvedValue(answer(413));
		vi.stubGlobal("fetch", fetchMock);
		await expect(uploadPart(address, part, wait)).rejects.toThrow("413");
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	test("does not retry when the server will not give an address (the recording is over)", async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		const refused = Object.assign(new Error("Nagranie jest już zakończone"), {
			status: 409,
		});
		await expect(
			uploadPart(() => Promise.reject(refused), part, wait),
		).rejects.toThrow("zakończone");
		expect(fetchMock).not.toHaveBeenCalled();
	});

	test("retries when the address could not be asked for at all", async () => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(answer(200)));
		const addr = vi
			.fn()
			.mockRejectedValueOnce(new TypeError("offline"))
			.mockImplementation(address);
		await uploadPart(addr, part, wait);
		expect(addr).toHaveBeenCalledTimes(2);
	});
});
