/**
 * A budget for the cached paths of the board (R-100), as R-090 is for images: past it, the paths
 * of elements not painted for the longest are dropped and built again when they are next seen.
 * What the latest frame painted is never dropped: when everything in view is over the budget it
 * simply stays over it (dropping it would only make every frame build it again).
 */
export class PathBudget<T extends { cost: number; used: number }> {
	private entries = new Set<T>();
	/** The estimated bytes of all the paths now cached. */
	total = 0;

	constructor(
		private max: number,
		private drop: (e: T) => void,
	) {}

	/** Starts counting an entry whose path was just built in `frame`. */
	add(e: T, frame: number): void {
		e.used = frame;
		this.entries.add(e);
		this.total += e.cost;
	}

	/** The entry was painted in `frame`. */
	touch(e: T, frame: number): void {
		e.used = frame;
	}

	/** The entry's path was built again (its cost is now `e.cost`, it was `was`). */
	replace(e: T, was: number, frame: number): void {
		e.used = frame;
		this.total += e.cost - was;
		this.entries.add(e);
	}

	/** Stops counting an entry (its element is gone). */
	forget(e: T): void {
		if (this.entries.delete(e)) this.total -= e.cost;
	}

	/** Forgets everything (the paths were thrown away with their cache). */
	clear(): void {
		this.entries.clear();
		this.total = 0;
	}

	/** After painting `frame`: drops the longest unused paths until the budget is met. */
	sweep(frame: number): void {
		if (this.total <= this.max) return;
		const idle = [...this.entries]
			.filter((e) => e.used < frame)
			.sort((a, b) => a.used - b.used);
		for (const e of idle) {
			if (this.total <= this.max) break;
			this.entries.delete(e);
			this.total -= e.cost;
			this.drop(e);
		}
	}
}
