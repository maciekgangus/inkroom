import type { BoardFolder, BoardMarker, BoardSummary } from "./api";

/** How the panel groups boards (R-121). */
export type GroupBy = "none" | "folder" | "marker" | "date" | "owner";

/** How the panel orders boards (R-091, R-121). */
export type BoardSort = "changed" | "name" | "size" | "custom";

/** The filter, sort and grouping state of the boards panel (R-091, R-121). */
export interface BoardFilter {
	/** Words that must all be found in a board's name, owner, folder, labels or date. */
	query: string;
	/** Which lists show: both, only own boards or only boards shared with me. */
	scope: "all" | "mine" | "shared";
	/** Only boards changed within this long: today, 7 or 30 days. */
	range: "any" | "today" | "7" | "30";
	sort: BoardSort;
	/** Reverses the active sort direction (e.g. oldest first, Z–A, smallest first). */
	reversed?: boolean;
	/** Active folder view: "all", "unfiled", or a folder id. */
	folder?: string;
	/** Only boards carrying all of these label (marker) ids. */
	markerIds?: string[];
	/** Only pinned boards. */
	pinnedOnly?: boolean;
	/** Custom grouping mode. */
	groupBy?: GroupBy;
}

export const DEFAULT_FILTER: BoardFilter = {
	query: "",
	scope: "all",
	range: "any",
	sort: "changed",
	reversed: false,
	folder: "all",
	markerIds: [],
	pinnedOnly: false,
	groupBy: "none",
};

/** Optional lookup maps so search also matches folder and label names. */
export interface FilterLookup {
	folders?: BoardFolder[];
	markers?: BoardMarker[];
}

/**
 * True when search, range, scope, sort, grouping or labels differ from defaults.
 * Folder navigation and pinned view are workspace navigation, not "active filter",
 * unless combined with narrowing filters.
 */
export function isFiltering(f: BoardFilter): boolean {
	return (
		f.query.trim() !== "" ||
		f.scope !== DEFAULT_FILTER.scope ||
		f.range !== DEFAULT_FILTER.range ||
		f.sort !== DEFAULT_FILTER.sort ||
		Boolean(f.reversed) ||
		(f.markerIds !== undefined && f.markerIds.length > 0) ||
		(f.groupBy !== undefined && f.groupBy !== "none")
	);
}

/** True when any filter popover control (excluding search & sidebar nav) differs from default. */
export function hasPopoverFilters(f: BoardFilter): boolean {
	return (
		f.scope !== DEFAULT_FILTER.scope ||
		f.range !== DEFAULT_FILTER.range ||
		f.sort !== DEFAULT_FILTER.sort ||
		Boolean(f.reversed) ||
		(f.groupBy !== undefined && f.groupBy !== "none")
	);
}

/** Human-readable Polish direction label for each sort mode. */
export function sortDirectionLabel(sort: BoardSort, reversed: boolean): string {
	switch (sort) {
		case "changed":
			return reversed ? "Od najstarszych" : "Od najnowszych";
		case "name":
			return reversed ? "Z–A" : "A–Z";
		case "size":
			return reversed ? "Od najmniejszych" : "Od największych";
		case "custom":
			return "Własna";
	}
}

const DAY = 24 * 60 * 60 * 1000;

/** What a board is searched by: name, owner, folder, labels and the date as 2026-11-17 and as 17.11.2026. */
function haystack(
	b: BoardSummary,
	folderNames: Map<string, string>,
	markerNames: Map<string, string>,
): string {
	const d = new Date(b.updatedAt);
	const p = (n: number) => String(n).padStart(2, "0");
	const day = `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
	const iso = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
	const folder = b.folderId ? (folderNames.get(b.folderId) ?? "") : "";
	const markers = (b.markerIds ?? [])
		.map((id) => markerNames.get(id) ?? "")
		.join(" ");
	const owners = (b.owners ?? []).join(" ");
	return `${b.name} ${b.owner ?? ""} ${owners} ${folder} ${markers} ${iso} ${day}`.toLowerCase();
}

/** The boards that pass the filter's search, time range, folder, pin and label checks, in its order. */
export function filterBoards(
	boards: BoardSummary[],
	f: BoardFilter,
	now: Date = new Date(),
	lookup?: FilterLookup,
): BoardSummary[] {
	const words = f.query.toLowerCase().split(/\s+/).filter(Boolean);
	const since =
		f.range === "today"
			? new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
			: f.range === "any"
				? -Infinity
				: now.getTime() - Number(f.range) * DAY;
	const folderNames = new Map(
		(lookup?.folders ?? []).map((fl) => [fl.id, fl.name]),
	);
	const markerNames = new Map(
		(lookup?.markers ?? []).map((mk) => [mk.id, mk.name]),
	);
	const activeFolder = f.folder ?? "all";
	const wantedMarkers = f.markerIds ?? [];

	const out = boards.filter((b) => {
		if (new Date(b.updatedAt).getTime() < since) return false;
		if (f.pinnedOnly && !b.pinned) return false;
		if (activeFolder === "unfiled" && b.folderId) return false;
		if (
			activeFolder !== "all" &&
			activeFolder !== "unfiled" &&
			b.folderId !== activeFolder
		) {
			return false;
		}
		if (wantedMarkers.length > 0) {
			const have = new Set(b.markerIds ?? []);
			if (!wantedMarkers.every((id) => have.has(id))) return false;
		}
		if (words.length === 0) return true;
		const h = haystack(b, folderNames, markerNames);
		return words.every((w) => h.includes(w));
	});

	const dir = f.reversed ? -1 : 1;
	const cmp = (a: BoardSummary, b: BoardSummary): number => {
		if (f.sort !== "custom" && Boolean(a.pinned) !== Boolean(b.pinned)) {
			return a.pinned ? -1 : 1;
		}
		let diff = 0;
		switch (f.sort) {
			case "name":
				diff = a.name.localeCompare(b.name, "pl", { sensitivity: "base" });
				break;
			case "size":
				diff = (b.bytes ?? 0) - (a.bytes ?? 0);
				break;
			case "custom": {
				const pa = a.position ?? 0;
				const pb = b.position ?? 0;
				if (pa > 0 && pb > 0) diff = pa - pb;
				else if (pa > 0) diff = 1;
				else if (pb > 0) diff = -1;
				else diff = b.updatedAt.localeCompare(a.updatedAt);
				break;
			}
			default:
				diff = b.updatedAt.localeCompare(a.updatedAt);
		}
		if (diff !== 0) return diff * dir;
		return b.updatedAt.localeCompare(a.updatedAt);
	};
	return out.sort(cmp);
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
