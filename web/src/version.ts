import { config } from "./api";

declare const __APP_VERSION__: string;

/** The release this page was built from; "dev" outside an image build (R-099). */
export const LOADED_VERSION: string =
	typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev";

const MIN_GAP_MS = 30_000;
const DISMISSED_KEY = "inkroom.dismissedVersion";

/**
 * The server's version when it differs from the one this page was loaded with, else null. A
 * development build or server, and a server that says nothing, never count as newer.
 */
export function newerVersion(
	loaded: string,
	server: string | undefined,
): string | null {
	if (!server || server === "dev" || loaded === "dev" || server === loaded) {
		return null;
	}
	return server;
}

type Store = Pick<Storage, "getItem" | "setItem">;

/**
 * Notices that the server runs a newer release than this page (R-099): asks for the server's
 * version at most every 30 seconds, keeps the newer one it saw, and remembers which one the person
 * dismissed, so only the next release brings the banner back.
 */
export class VersionWatch {
	private latest: string | null = null;
	private dismissed: string | null;
	private last = Number.NEGATIVE_INFINITY;
	private listeners = new Set<() => void>();

	constructor(
		private loaded: string,
		private fetchVersion: () => Promise<string | undefined>,
		private now: () => number = () => Date.now(),
		private store: Store | null = null,
	) {
		try {
			this.dismissed = store?.getItem(DISMISSED_KEY) ?? null;
		} catch {
			this.dismissed = null;
		}
	}

	/** The newer version to announce, or null when there is nothing to show. */
	get visible(): string | null {
		return this.latest && this.latest !== this.dismissed ? this.latest : null;
	}

	/** Asks the server which release it runs (unless that was done lately, or `force`). */
	async check({ force = false }: { force?: boolean } = {}): Promise<void> {
		const t = this.now();
		if (!force && t - this.last < MIN_GAP_MS) return;
		this.last = t;
		try {
			const found = newerVersion(this.loaded, await this.fetchVersion());
			if (found !== this.latest) {
				this.latest = found;
				this.emit();
			}
		} catch {
			// Offline or a server that is restarting: the next check will see.
		}
	}

	/** Hides the banner for this version. */
	dismiss(): void {
		if (!this.latest) return;
		this.dismissed = this.latest;
		try {
			this.store?.setItem(DISMISSED_KEY, this.latest);
		} catch {
			// Not remembering is fine.
		}
		this.emit();
	}

	subscribe(fn: () => void): () => void {
		this.listeners.add(fn);
		return () => void this.listeners.delete(fn);
	}

	private emit(): void {
		for (const fn of this.listeners) fn();
	}
}

function browserStore(): Store | null {
	try {
		return localStorage;
	} catch {
		return null;
	}
}

/** The one watch of the page. */
export const versionWatch = new VersionWatch(
	LOADED_VERSION,
	async () => (await config()).version,
	() => Date.now(),
	browserStore(),
);
