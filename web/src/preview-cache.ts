const PREFIX = "inkroom.preview.";
/** How many boards' pictures are kept; the oldest go first. */
const MAX_BOARDS = 60;

interface Entry {
	tag: string;
	url: string;
	at: number;
}

/** What was seen in this page's life: shown at once when a tile comes back, storage or not. */
const memory = new Map<string, { tag: string; url: string; checked: number }>();
const MAX_MEMORY = 200;

const read = (key: string): Entry | null => {
	try {
		const raw = localStorage.getItem(key);
		return raw ? (JSON.parse(raw) as Entry) : null;
	} catch {
		return null;
	}
};

/** Keeps the picture of a board's current version, in place of its older one, and tidies up. */
export function setPreview(boardId: string, tag: string, url: string): void {
	memory.delete(boardId); // so the newest is last
	memory.set(boardId, { tag, url, checked: Date.now() });
	if (memory.size > MAX_MEMORY)
		for (const k of [...memory.keys()].slice(0, memory.size - MAX_MEMORY))
			memory.delete(k);
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

/**
 * The last picture seen of a board, of whatever version, or null (R-080). A tile shows it at
 * once and checks in the background whether the board has changed since.
 */
export function peekPreview(
	boardId: string,
): { tag: string; url: string } | null {
	const m = memory.get(boardId);
	if (m) return { tag: m.tag, url: m.url };
	const e = read(PREFIX + boardId);
	return e ? { tag: e.tag, url: e.url } : null;
}

/** Notes that the picture of a board was just confirmed to be the current one. */
export function markChecked(boardId: string): void {
	const m = memory.get(boardId);
	if (m) m.checked = Date.now();
}

/** Whether the board's picture was confirmed within the last `ms`: no need to ask the server again. */
export function checkedRecently(boardId: string, ms: number): boolean {
	const m = memory.get(boardId);
	return !!m && Date.now() - m.checked < ms;
}

/** Forgets the pictures in memory, and in storage too unless `memoryOnly` (tests). */
export function forgetPreviews(memoryOnly = false): void {
	memory.clear();
	if (memoryOnly) return;
	try {
		for (const k of Object.keys(localStorage))
			if (k.startsWith(PREFIX)) localStorage.removeItem(k);
	} catch {
		// nothing to forget
	}
}
