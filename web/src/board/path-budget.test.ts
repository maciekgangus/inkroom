import { describe, expect, test } from "vitest";
import { PathBudget } from "./path-budget";

const entry = (cost: number) => {
	const e = { cost, used: 0, dropped: 0 };
	return e;
};

describe("PathBudget", () => {
	const make = (max: number) =>
		new PathBudget<ReturnType<typeof entry>>(max, (e) => {
			e.dropped++;
		});

	test("keeps everything while under the budget", () => {
		const b = make(100);
		const a = entry(40);
		const c = entry(40);
		b.add(a, 1);
		b.add(c, 1);
		b.sweep(2);
		expect(a.dropped + c.dropped).toBe(0);
		expect(b.total).toBe(80);
	});

	test("over the budget it drops the longest unused first, until it fits", () => {
		const b = make(100);
		const old = entry(40);
		const mid = entry(40);
		const fresh = entry(40);
		b.add(old, 1);
		b.add(mid, 2);
		b.add(fresh, 3);
		b.sweep(4); // frame 4 drew none of them
		expect(old.dropped).toBe(1);
		expect(mid.dropped).toBe(0);
		expect(fresh.dropped).toBe(0);
		expect(b.total).toBe(80);
	});

	test("never drops what the frame just drawn, even over the budget (no thrash)", () => {
		const b = make(50);
		const list = [entry(40), entry(40), entry(40)];
		for (const e of list) b.add(e, 5);
		b.sweep(5);
		expect(list.map((e) => e.dropped)).toEqual([0, 0, 0]);
		expect(b.total).toBe(120);
	});

	test("touching an entry again keeps it young", () => {
		const b = make(100);
		const a = entry(40);
		const c = entry(40);
		const d = entry(40);
		b.add(a, 1);
		b.add(c, 2);
		b.add(d, 3);
		b.touch(a, 4);
		b.sweep(5);
		expect(c.dropped).toBe(1);
		expect(a.dropped).toBe(0);
	});

	test("a replaced path counts only once", () => {
		const b = make(1000);
		const a = entry(40);
		b.add(a, 1);
		a.cost = 10;
		b.replace(a, 40, 2);
		expect(b.total).toBe(10);
	});

	test("forgetting an entry takes its cost off", () => {
		const b = make(1000);
		const a = entry(40);
		b.add(a, 1);
		b.forget(a);
		expect(b.total).toBe(0);
	});
});
