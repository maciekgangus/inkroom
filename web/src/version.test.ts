import { describe, expect, test, vi } from "vitest";
import { newerVersion, VersionWatch } from "./version";

const store = () => {
	const m = new Map<string, string>();
	return {
		getItem: (k: string) => m.get(k) ?? null,
		setItem: (k: string, v: string) => void m.set(k, v),
	};
};

describe("newerVersion (R-099)", () => {
	test("is the server's version when it differs from the loaded one", () => {
		expect(newerVersion("v0.7.0", "v0.7.1")).toBe("v0.7.1");
	});
	test("says nothing when the versions match", () => {
		expect(newerVersion("v0.7.0", "v0.7.0")).toBeNull();
	});
	test("says nothing in a development build or against a development server", () => {
		expect(newerVersion("dev", "v0.7.1")).toBeNull();
		expect(newerVersion("v0.7.1", "dev")).toBeNull();
		expect(newerVersion("v0.7.1", undefined)).toBeNull();
		expect(newerVersion("v0.7.1", "")).toBeNull();
	});
});

describe("VersionWatch (R-099)", () => {
	const make = (server: () => string | undefined, loaded = "v1") => {
		let t = 0;
		const fetchVersion = vi.fn(async () => server());
		const watch = new VersionWatch(loaded, fetchVersion, () => t, store());
		return { watch, fetchVersion, advance: (ms: number) => (t += ms) };
	};

	test("shows nothing until a check finds a different version", async () => {
		let v: string | undefined = "v1";
		const { watch, advance } = make(() => v);
		await watch.check();
		expect(watch.visible).toBeNull();
		v = "v2";
		advance(31_000);
		await watch.check();
		expect(watch.visible).toBe("v2");
	});

	test("checks at most every 30 seconds", async () => {
		const { watch, fetchVersion, advance } = make(() => "v1");
		await watch.check();
		advance(10_000);
		await watch.check();
		expect(fetchVersion).toHaveBeenCalledOnce();
		advance(21_000);
		await watch.check();
		expect(fetchVersion).toHaveBeenCalledTimes(2);
	});

	test("a dismissed version stays quiet, the next one is shown", async () => {
		let v: string | undefined = "v2";
		const { watch, advance } = make(() => v);
		await watch.check();
		watch.dismiss();
		expect(watch.visible).toBeNull();
		advance(31_000);
		await watch.check();
		expect(watch.visible).toBeNull(); // still v2
		v = "v3";
		advance(31_000);
		await watch.check();
		expect(watch.visible).toBe("v3");
	});

	test("remembers the dismissal across a reload", async () => {
		const s = store();
		const a = new VersionWatch(
			"v1",
			async () => "v2",
			() => 0,
			s,
		);
		await a.check();
		a.dismiss();
		const b = new VersionWatch(
			"v1",
			async () => "v2",
			() => 0,
			s,
		);
		await b.check();
		expect(b.visible).toBeNull();
	});

	test("a failing check is silent and does not clear a known newer version", async () => {
		let fail = false;
		const watch = new VersionWatch(
			"v1",
			async () => {
				if (fail) throw new Error("offline");
				return "v2";
			},
			() => 0,
			store(),
		);
		await watch.check();
		fail = true;
		await expect(watch.check({ force: true })).resolves.toBeUndefined();
		expect(watch.visible).toBe("v2");
	});

	test("tells its subscribers when what is shown changes", async () => {
		const { watch } = make(() => "v2");
		const seen = vi.fn();
		const off = watch.subscribe(seen);
		await watch.check();
		expect(seen).toHaveBeenCalled();
		off();
		seen.mockClear();
		watch.dismiss();
		expect(seen).not.toHaveBeenCalled();
	});
});
