/** The subset of HTMLImageElement the cache uses (lets tests supply a fake). */
export interface ImageLike {
	src: string;
	complete: boolean;
	naturalWidth: number;
	onload: (() => void) | null;
	onerror: (() => void) | null;
}

/** Loads a board's images once each and asks for a repaint when one arrives. */
export class ImageCache {
	private images = new Map<string, ImageLike>();
	private failures = new Set<string>();

	constructor(
		private boardId: string,
		private onLoad: () => void,
		private create: () => ImageLike = () => new Image() as unknown as ImageLike,
	) {}

	/** The loaded image, or null while it is loading or failed (draw a placeholder then). */
	get(src: string): ImageLike | null {
		let img = this.images.get(src);
		if (!img) {
			img = this.create();
			this.images.set(src, img);
			const loading = img;
			loading.onload = () => this.onLoad();
			loading.onerror = () => this.failures.add(src);
			loading.src = `/api/boards/${this.boardId}/images/${src}`;
		}
		return img.complete && img.naturalWidth > 0 && !this.failures.has(src)
			? img
			: null;
	}

	/** True if the image could not be loaded. */
	failed(src: string): boolean {
		return this.failures.has(src);
	}
}
