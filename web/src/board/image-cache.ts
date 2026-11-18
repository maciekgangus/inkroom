/** The subset of HTMLImageElement the cache uses (lets tests supply a fake). */
export interface ImageLike {
	src: string;
	complete: boolean;
	naturalWidth: number;
	naturalHeight: number;
	onload: (() => void) | null;
	onerror: (() => void) | null;
}

/** Limits on the memory the decoded images may hold (R-090). */
export interface ImageBudget {
	/** Most decoded pixels (4 bytes each) kept at once; unused images beyond it are dropped. */
	maxPixels: number;
	/** An image drawn this recently (ms) is never dropped, even over the budget. */
	idleMs: number;
	now: () => number;
}

/** A tablet with little memory gets a smaller budget: its page is killed when it runs out. */
function defaultBudget(): ImageBudget {
	const gb = (navigator as { deviceMemory?: number }).deviceMemory ?? 4;
	return {
		maxPixels: gb >= 8 ? 96_000_000 : 40_000_000,
		idleMs: 1500,
		now: () => performance.now(),
	};
}

/**
 * Loads a board's images once each and asks for a repaint when one arrives. Decoded images are
 * kept within a pixel budget: past it, those not drawn lately are dropped and load again when
 * they are next needed (R-090), so a board of many large pages does not exhaust a tablet's memory.
 */
export class ImageCache {
	private images = new Map<string, ImageLike>();
	private failures = new Set<string>();
	private lastUsed = new Map<string, number>();
	private pixels = new Map<string, number>();
	private total = 0;
	private budget: ImageBudget;

	constructor(
		private boardId: string,
		private onLoad: () => void,
		private create: () => ImageLike = () => new Image() as unknown as ImageLike,
		budget?: ImageBudget,
	) {
		this.budget = budget ?? defaultBudget();
	}

	/** The loaded image, or null while it is loading or failed (draw a placeholder then). */
	get(src: string): ImageLike | null {
		let img = this.images.get(src);
		if (!img) {
			img = this.create();
			this.images.set(src, img);
			const loading = img;
			loading.onload = () => {
				const px = loading.naturalWidth * loading.naturalHeight;
				this.pixels.set(src, px);
				this.total += px;
				this.onLoad();
			};
			loading.onerror = () => this.failures.add(src);
			loading.src = `/api/boards/${this.boardId}/images/${src}`;
		}
		this.lastUsed.set(src, this.budget.now());
		if (this.total > this.budget.maxPixels) this.evict();
		return img.complete && img.naturalWidth > 0 && !this.failures.has(src)
			? img
			: null;
	}

	/** Drops the longest unused images until the budget is met, sparing those drawn lately. */
	private evict(): void {
		const now = this.budget.now();
		const idle = [...this.pixels.keys()]
			.filter((s) => now - (this.lastUsed.get(s) ?? 0) >= this.budget.idleMs)
			.sort(
				(a, b) => (this.lastUsed.get(a) ?? 0) - (this.lastUsed.get(b) ?? 0),
			);
		for (const src of idle) {
			if (this.total <= this.budget.maxPixels) break;
			const img = this.images.get(src);
			if (img) {
				img.onload = null;
				img.onerror = null;
				img.src = "";
			}
			this.total -= this.pixels.get(src) ?? 0;
			this.images.delete(src);
			this.pixels.delete(src);
			this.lastUsed.delete(src);
		}
	}

	/** True if the image could not be loaded. */
	failed(src: string): boolean {
		return this.failures.has(src);
	}
}
