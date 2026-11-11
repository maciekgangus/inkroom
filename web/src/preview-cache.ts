const PREFIX = "inkroom.preview.";
/** How many boards' pictures are kept; the oldest go first. */
const MAX_BOARDS = 60;

interface Entry {
	tag: string;
	url: string;
	at: number;
}

const read = (key: string): Entry | null => {
	try {
		const raw = localStorage.getItem(key);
		return raw ? (JSON.parse(raw) as Entry) : null;
	} catch {
		return null;
	}
};

/**
 * The picture kept for this version of a board (`tag` is the server's ETag: it changes when the
 * board does), or null. Storage may be unavailable, so nothing here ever throws.
 */
export function getPreview(boardId: string, tag: string): string | null {
	const e = read(PREFIX + boardId);
	return e && e.tag === tag ? e.url : null;
}

/** Keeps the picture of a board's current version, in place of its older one, and tidies up. */
export function setPreview(boardId: string, tag: string, url: string): void {
	try {
		localStorage.setItem(
			PREFIX + boardId,
			JSON.stringify({ tag, url, at: Date.now() } satisfies Entry),
		);
		const keys = Object.keys(localStorage).filter((k) => k.startsWith(PREFIX));
		if (keys.length <= MAX_BOARDS) return;
		keys
			.map((k) => ({ k, at: read(k)?.at ?? 0 }))
			.sort((a, b) => a.at - b.at)
			.slice(0, keys.length - MAX_BOARDS)
			.forEach(({ k }) => {
				localStorage.removeItem(k);
			});
	} catch {
		// Not remembering is fine: the picture is drawn again next time.
	}
}
