import type { BoardSummary } from "./api";

/** The filter of the boards panel (R-091). */
export interface BoardFilter {
	/** Words that must all be found in a board's name, owner or last-change date. */
	query: string;
	/** Which lists show: both, only own boards or only boards shared with me. */
	scope: "all" | "mine" | "shared";
	/** Only boards changed within this long: today, 7 or 30 days. */
	range: "any" | "today" | "7" | "30";
	sort: "changed" | "name" | "size";
}

export const DEFAULT_FILTER: BoardFilter = {
	query: "",
	scope: "all",
	range: "any",
	sort: "changed",
};

/** True when the filter differs from the default, so the panel shows that it narrows the lists. */
export function isFiltering(f: BoardFilter): boolean {
	return (
		f.query.trim() !== "" ||
		f.scope !== DEFAULT_FILTER.scope ||
		f.range !== DEFAULT_FILTER.range ||
		f.sort !== DEFAULT_FILTER.sort
	);
}

const DAY = 24 * 60 * 60 * 1000;

/** What a board is searched by: name, owner and the date as 2026-11-17 and as 17.11.2026. */
function haystack(b: BoardSummary): string {
	const d = new Date(b.updatedAt);
	const p = (n: number) => String(n).padStart(2, "0");
	const day = `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
	const iso = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
	return `${b.name} ${b.owner ?? ""} ${iso} ${day}`.toLowerCase();
}

/** The boards that pass the filter's search and time range, in its order; the input is untouched. */
export function filterBoards(
	boards: BoardSummary[],
	f: BoardFilter,
	now: Date = new Date(),
): BoardSummary[] {
	const words = f.query.toLowerCase().split(/\s+/).filter(Boolean);
	const since =
		f.range === "today"
			? new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
			: f.range === "any"
				? -Infinity
				: now.getTime() - Number(f.range) * DAY;
	const out = boards.filter((b) => {
		if (new Date(b.updatedAt).getTime() < since) return false;
		const h = haystack(b);
		return words.every((w) => h.includes(w));
	});
	const order = {
		name: (a: BoardSummary, b: BoardSummary) =>
			a.name.localeCompare(b.name, "pl", { sensitivity: "base" }),
		size: (a: BoardSummary, b: BoardSummary) => (b.bytes ?? 0) - (a.bytes ?? 0),
		changed: (a: BoardSummary, b: BoardSummary) =>
			b.updatedAt.localeCompare(a.updatedAt),
	}[f.sort];
	return out.sort(order);
}

/** A board's size for a tile: "0,4 MB", "12 MB", "<0,1 MB" for a tiny one; nothing if unknown. */
export function formatSize(bytes: number | undefined): string {
	if (bytes === undefined) return "";
	const mb = bytes / (1024 * 1024);
	if (mb < 0.1) return "<0,1 MB";
	const text =
		mb < 9.95 ? mb.toFixed(1).replace(".", ",") : String(Math.round(mb));
	return `${text} MB`;
}
