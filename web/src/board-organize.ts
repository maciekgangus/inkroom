import type { BoardFolder, BoardMarker, BoardSummary, OrgColor } from "./api";
import type { GroupBy } from "./board-filter";

/** Restrained ink color tokens for folders and markers, styled to match DESIGN.md in light & dark mode. */
export const ORG_COLORS: { id: OrgColor; label: string }[] = [
	{ id: "", label: "Bez koloru" },
	{ id: "indigo", label: "Indygo" },
	{ id: "emerald", label: "Szmaragd" },
	{ id: "amber", label: "Bursztyn" },
	{ id: "rose", label: "Róż" },
	{ id: "sky", label: "Błękit" },
	{ id: "violet", label: "Fiolet" },
	{ id: "slate", label: "Łupek" },
];

export interface BoardEntry {
	board: BoardSummary;
	mine: boolean;
}

export interface BoardGroup {
	key: string;
	title: string;
	color?: OrgColor;
	folderId?: string;
	markerId?: string;
	entries: BoardEntry[];
}

const DAY = 24 * 60 * 60 * 1000;

/** Groups an already-filtered and ordered list of boards by folder, marker, date or owner. */
export function groupBoards(
	entries: BoardEntry[],
	groupBy: Exclude<GroupBy, "none">,
	folders: BoardFolder[],
	markers: BoardMarker[],
	now: Date = new Date(),
	includeEmptyFolders = false,
): BoardGroup[] {
	if (groupBy === "folder") {
		const byFolder = new Map<string, BoardEntry[]>();
		const unfiled: BoardEntry[] = [];
		const folderIds = new Set(folders.map((f) => f.id));
		for (const e of entries) {
			if (e.board.folderId && folderIds.has(e.board.folderId)) {
				const list = byFolder.get(e.board.folderId) ?? [];
				list.push(e);
				byFolder.set(e.board.folderId, list);
			} else {
				unfiled.push(e);
			}
		}
		const groups: BoardGroup[] = [];
		for (const f of folders) {
			const list = byFolder.get(f.id) ?? [];
			if (list.length > 0 || includeEmptyFolders) {
				groups.push({
					key: `folder:${f.id}`,
					title: f.name,
					color: f.color,
					folderId: f.id,
					entries: list,
				});
			}
		}
		if (unfiled.length > 0) {
			groups.push({
				key: "folder:unfiled",
				title: "Bez folderu",
				entries: unfiled,
			});
		}
		return groups;
	}

	if (groupBy === "marker") {
		const byMarker = new Map<string, BoardEntry[]>();
		const unmarked: BoardEntry[] = [];
		const markerIds = new Set(markers.map((m) => m.id));
		for (const e of entries) {
			const ids = (e.board.markerIds ?? []).filter((id) => markerIds.has(id));
			if (ids.length === 0) {
				unmarked.push(e);
				continue;
			}
			for (const id of ids) {
				const list = byMarker.get(id) ?? [];
				list.push(e);
				byMarker.set(id, list);
			}
		}
		const groups: BoardGroup[] = [];
		for (const m of markers) {
			const list = byMarker.get(m.id) ?? [];
			if (list.length > 0) {
				groups.push({
					key: `marker:${m.id}`,
					title: m.name,
					color: m.color,
					markerId: m.id,
					entries: list,
				});
			}
		}
		if (unmarked.length > 0) {
			groups.push({
				key: "marker:none",
				title: "Bez etykiet",
				entries: unmarked,
			});
		}
		return groups;
	}

	if (groupBy === "date") {
		const startOfToday = new Date(
			now.getFullYear(),
			now.getMonth(),
			now.getDate(),
		).getTime();
		const weekAgo = now.getTime() - 7 * DAY;
		const monthAgo = now.getTime() - 30 * DAY;
		const buckets: { key: string; title: string; entries: BoardEntry[] }[] = [
			{ key: "date:today", title: "Dziś", entries: [] },
			{ key: "date:7", title: "Ostatnie 7 dni", entries: [] },
			{ key: "date:30", title: "Ostatnie 30 dni", entries: [] },
			{ key: "date:older", title: "Starsze", entries: [] },
		];
		for (const e of entries) {
			const t = new Date(e.board.updatedAt).getTime();
			if (t >= startOfToday) buckets[0].entries.push(e);
			else if (t >= weekAgo) buckets[1].entries.push(e);
			else if (t >= monthAgo) buckets[2].entries.push(e);
			else buckets[3].entries.push(e);
		}
		return buckets.filter((b) => b.entries.length > 0);
	}

	// groupBy === "owner"
	const mine: BoardEntry[] = [];
	const byOwner = new Map<string, BoardEntry[]>();
	for (const e of entries) {
		if (e.mine) {
			mine.push(e);
		} else {
			const key = e.board.owner || "Udostępnione";
			const list = byOwner.get(key) ?? [];
			list.push(e);
			byOwner.set(key, list);
		}
	}
	const groups: BoardGroup[] = [];
	if (mine.length > 0) {
		groups.push({ key: "owner:mine", title: "Moje tablice", entries: mine });
	}
	for (const [owner, list] of [...byOwner.entries()].sort((a, b) =>
		a[0].localeCompare(b[0], "pl", { sensitivity: "base" }),
	)) {
		groups.push({
			key: `owner:${owner}`,
			title: `Od: ${owner}`,
			entries: list,
		});
	}
	return groups;
}

/** One deterministic, 1-click organization suggestion derived from board names, owners and dates. */
export type OrgSuggestion =
	| {
			id: string;
			kind: "move-to-folder";
			title: string;
			reason: string;
			folderId: string;
			boardIds: string[];
			boardNames: string[];
			color?: OrgColor;
	  }
	| {
			id: string;
			kind: "create-folder";
			title: string;
			reason: string;
			folderName: string;
			color: OrgColor;
			boardIds: string[];
			boardNames: string[];
	  }
	| {
			id: string;
			kind: "apply-marker";
			title: string;
			reason: string;
			markerName: string;
			markerId?: string;
			color: OrgColor;
			boardIds: string[];
			boardNames: string[];
	  };

const STOP_WORDS = new Set([
	"nowa",
	"nowy",
	"nowe",
	"tablica",
	"tablice",
	"kopia",
	"lekcja",
	"zajecia",
	"zajęcia",
	"zadanie",
	"zadania",
	"klasa",
	"grupa",
	"notatki",
	"test",
	"korepetycje",
	"bez",
	"dla",
	"moj",
	"mój",
	"moja",
]);

const KEYWORD_MARKERS: {
	key: string;
	pattern: RegExp;
	name: string;
	color: OrgColor;
}[] = [
	{ key: "matura", pattern: /\bmatur\p{L}*/iu, name: "Matura", color: "rose" },
	{
		key: "sprawdzian",
		pattern: /\b(sprawdzian|kartk[oó]wk)\p{L}*/iu,
		name: "Sprawdzian",
		color: "amber",
	},
	{
		key: "egzamin",
		pattern: /\b(egzamin|[oó]smoklas)\p{L}*/iu,
		name: "Egzamin",
		color: "violet",
	},
	{
		key: "powtorka",
		pattern: /\bpowt[oó]rk\p{L}*/iu,
		name: "Powtórka",
		color: "sky",
	},
	{
		key: "zadanie-domowe",
		pattern: /\b(zadani\p{L}*\s+domow|prac\p{L}*\s+domow)\p{L}*/iu,
		name: "Zadanie domowe",
		color: "emerald",
	},
];

const TOPIC_COLORS: OrgColor[] = [
	"indigo",
	"emerald",
	"sky",
	"violet",
	"amber",
	"rose",
];

function pickColor(seed: string): OrgColor {
	let hash = 0;
	for (let i = 0; i < seed.length; i++) {
		hash = (hash * 31 + seed.charCodeAt(i)) | 0;
	}
	return TOPIC_COLORS[Math.abs(hash) % TOPIC_COLORS.length];
}

function normalize(s: string): string {
	return s
		.toLowerCase()
		.normalize("NFD")
		.replace(/\p{Diacritic}/gu, "")
		.trim();
}

function polishBoardsCount(n: number): string {
	if (n === 1) return "1 tablica";
	const mod10 = n % 10;
	const mod100 = n % 100;
	if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
		return `${n} tablice`;
	}
	return `${n} tablic`;
}

/** Extracts a leading topic phrase from a board name (e.g. "Matematyka - funkcje" -> "Matematyka"). */
function extractTopic(name: string): { key: string; label: string } | null {
	const trimmed = name.trim();
	if (!trimmed) return null;
	// Prefer explicit separator prefix like "Matematyka - ..." or "Ania: ...".
	const sep = trimmed.split(/\s*(?:—|–|-|:|\/|\|)\s*/);
	let candidate =
		sep.length > 1 ? sep[0].trim() : (trimmed.split(/\s+/)[0] ?? "");
	candidate = candidate.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
	if (candidate.length < 3 || candidate.length > 36) return null;
	if (/^\d+$/.test(candidate)) return null;
	const key = normalize(candidate);
	if (key.length < 3 || STOP_WORDS.has(key)) return null;
	const label = candidate.charAt(0).toUpperCase() + candidate.slice(1);
	return { key, label };
}

/**
 * Produces up to `limit` quiet, actionable suggestions for organizing the user's boards.
 * Pure & deterministic so it runs instantaneously offline with zero external calls.
 */
export function suggestOrganization(params: {
	boards: BoardSummary[];
	folders: BoardFolder[];
	markers: BoardMarker[];
	now?: Date;
	dismissed?: ReadonlySet<string>;
	limit?: number;
}): OrgSuggestion[] {
	const {
		boards,
		folders,
		markers,
		now = new Date(),
		dismissed = new Set<string>(),
		limit = 4,
	} = params;
	const suggestions: OrgSuggestion[] = [];
	const unfiled = boards.filter((b) => !b.folderId);
	const claimedByFolder = new Set<string>();
	const folderByNorm = new Map(folders.map((f) => [normalize(f.name), f]));
	const markerByNorm = new Map(markers.map((m) => [normalize(m.name), m]));

	// 1. Match unfiled boards to existing folders by name.
	for (const f of folders) {
		const normFolder = normalize(f.name);
		if (normFolder.length < 3) continue;
		const matching = unfiled.filter((b) => {
			if (claimedByFolder.has(b.id)) return false;
			const normName = normalize(b.name);
			return (
				normName === normFolder ||
				normName.startsWith(`${normFolder} `) ||
				normName.startsWith(`${normFolder}-`) ||
				normName.startsWith(`${normFolder}:`) ||
				normName.includes(` ${normFolder} `) ||
				(b.owner && normalize(b.owner) === normFolder)
			);
		});
		if (matching.length === 0) continue;
		const id = `move-to-folder:${f.id}`;
		if (dismissed.has(id)) continue;
		for (const b of matching) claimedByFolder.add(b.id);
		suggestions.push({
			id,
			kind: "move-to-folder",
			title: `Przenieś do folderu „${f.name}”`,
			reason: `${polishBoardsCount(matching.length)} pasuje nazwą`,
			folderId: f.id,
			color: f.color,
			boardIds: matching.map((b) => b.id),
			boardNames: matching.map((b) => b.name),
		});
	}

	// 2. Suggest creating a folder for repeated leading topics across unfiled boards.
	const topicGroups = new Map<
		string,
		{ label: string; boardIds: string[]; boardNames: string[] }
	>();
	for (const b of unfiled) {
		if (claimedByFolder.has(b.id)) continue;
		const topic = extractTopic(b.name);
		if (!topic || folderByNorm.has(topic.key)) continue;
		const entry = topicGroups.get(topic.key) ?? {
			label: topic.label,
			boardIds: [],
			boardNames: [],
		};
		entry.boardIds.push(b.id);
		entry.boardNames.push(b.name);
		topicGroups.set(topic.key, entry);
	}
	const sortedTopics = [...topicGroups.entries()]
		.filter(([, g]) => g.boardIds.length >= 2)
		.sort((a, b) => b[1].boardIds.length - a[1].boardIds.length);

	for (const [key, g] of sortedTopics) {
		const id = `create-folder:${key}`;
		if (dismissed.has(id)) continue;
		for (const bid of g.boardIds) claimedByFolder.add(bid);
		suggestions.push({
			id,
			kind: "create-folder",
			title: `Utwórz folder „${g.label}”`,
			reason: `${polishBoardsCount(g.boardIds.length)} o wspólnym temacie`,
			folderName: g.label,
			color: pickColor(key),
			boardIds: g.boardIds,
			boardNames: g.boardNames,
		});
	}

	// 3. Suggest creating a folder for 2+ unfiled shared boards from the same person.
	const ownerGroups = new Map<string, { ids: string[]; names: string[] }>();
	for (const b of unfiled) {
		if (!b.owner || claimedByFolder.has(b.id)) continue;
		if (folderByNorm.has(normalize(b.owner))) continue;
		const entry = ownerGroups.get(b.owner) ?? { ids: [], names: [] };
		entry.ids.push(b.id);
		entry.names.push(b.name);
		ownerGroups.set(b.owner, entry);
	}
	for (const [owner, g] of ownerGroups) {
		if (g.ids.length < 2) continue;
		const id = `create-folder-owner:${normalize(owner)}`;
		if (dismissed.has(id)) continue;
		suggestions.push({
			id,
			kind: "create-folder",
			title: `Utwórz folder „${owner}”`,
			reason: `${polishBoardsCount(g.ids.length)} udostępnionych przez ${owner}`,
			folderName: owner,
			color: pickColor(owner),
			boardIds: g.ids,
			boardNames: g.names,
		});
	}

	// 4. Suggest tutoring labels based on keywords in board names.
	for (const kw of KEYWORD_MARKERS) {
		const existing = markerByNorm.get(normalize(kw.name));
		const matching = boards.filter((b) => {
			if (!kw.pattern.test(b.name)) return false;
			if (existing && (b.markerIds ?? []).includes(existing.id)) return false;
			return true;
		});
		if (matching.length < 2) continue;
		const id = `apply-marker:${kw.key}`;
		if (dismissed.has(id)) continue;
		suggestions.push({
			id,
			kind: "apply-marker",
			title: `Dodaj etykietę „${existing?.name ?? kw.name}”`,
			reason: `${polishBoardsCount(matching.length)} pasuje do etykiety`,
			markerName: existing?.name ?? kw.name,
			markerId: existing?.id,
			color: existing?.color || kw.color,
			boardIds: matching.map((b) => b.id),
			boardNames: matching.map((b) => b.name),
		});
	}

	// 5. Suggest marking old boards (>60 days untouched) as "Archiwum".
	const archiveCutoff = now.getTime() - 60 * DAY;
	const archiveMarker = markerByNorm.get("archiwum");
	const archiveFolder = folderByNorm.get("archiwum");
	const stale = boards.filter((b) => {
		if (new Date(b.updatedAt).getTime() >= archiveCutoff) return false;
		if (archiveFolder && b.folderId === archiveFolder.id) return false;
		if (archiveMarker && (b.markerIds ?? []).includes(archiveMarker.id))
			return false;
		return true;
	});
	if (stale.length >= 3 && !dismissed.has("archive:60d")) {
		suggestions.push({
			id: "archive:60d",
			kind: "apply-marker",
			title: "Oznacz starsze etykietą „Archiwum”",
			reason: `${polishBoardsCount(stale.length)} niezmienianych od ponad 60 dni`,
			markerName: archiveMarker?.name ?? "Archiwum",
			markerId: archiveMarker?.id,
			color: archiveMarker?.color || "slate",
			boardIds: stale.map((b) => b.id),
			boardNames: stale.map((b) => b.name),
		});
	}

	return suggestions.slice(0, limit);
}

/** Moves `fromId` to the position of `toId` without mutating the input array. */
export function moveItem(
	ids: string[],
	fromId: string,
	toId: string,
): string[] {
	const from = ids.indexOf(fromId);
	const to = ids.indexOf(toId);
	if (from < 0 || to < 0 || from === to) return ids;
	const next = [...ids];
	const [item] = next.splice(from, 1);
	next.splice(to, 0, item);
	return next;
}

/** Moves `id` by `delta` (-1 up/left, +1 down/right) without mutating the input array. */
export function nudgeItem(ids: string[], id: string, delta: -1 | 1): string[] {
	const idx = ids.indexOf(id);
	const target = idx + delta;
	if (idx < 0 || target < 0 || target >= ids.length) return ids;
	return moveItem(ids, id, ids[target]);
}
