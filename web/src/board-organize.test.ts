import { describe, expect, test } from "vitest";
import type { BoardFolder, BoardMarker, BoardSummary } from "./api";
import {
	groupBoards,
	moveItem,
	nudgeItem,
	suggestOrganization,
} from "./board-organize";

const at = (iso: string) => new Date(iso).toISOString();
const NOW = new Date("2026-11-25T12:00:00Z");

describe("groupBoards (R-121)", () => {
	const folders: BoardFolder[] = [
		{ id: "f1", name: "Matematyka", color: "indigo", position: 0 },
		{ id: "f2", name: "Fizyka", color: "emerald", position: 1 },
	];
	const markers: BoardMarker[] = [
		{ id: "m1", name: "Matura", color: "rose" },
		{ id: "m2", name: "Pilne", color: "amber" },
	];
	const entries = [
		{
			mine: true,
			board: {
				id: "b1",
				name: "Funkcje",
				updatedAt: at("2026-11-25T10:00:00Z"),
				folderId: "f1",
				markerIds: ["m1", "m2"],
			},
		},
		{
			mine: true,
			board: {
				id: "b2",
				name: "Optyka",
				updatedAt: at("2026-11-20T10:00:00Z"),
				markerIds: ["m1"],
			},
		},
		{
			mine: false,
			board: {
				id: "b3",
				name: "Zadania",
				updatedAt: at("2026-08-01T10:00:00Z"),
				owner: "Ania",
			},
		},
	];

	test("groups by folder in folder order and puts unfiled last", () => {
		const groups = groupBoards(entries, "folder", folders, markers, NOW, true);
		expect(groups.map((g) => g.title)).toEqual([
			"Matematyka",
			"Fizyka",
			"Bez folderu",
		]);
		expect(groups[0].entries.map((e) => e.board.id)).toEqual(["b1"]);
		expect(groups[1].entries).toEqual([]);
		expect(groups[2].entries.map((e) => e.board.id)).toEqual(["b2", "b3"]);
	});

	test("groups by marker and lists multi-tagged boards under each marker", () => {
		const groups = groupBoards(entries, "marker", folders, markers, NOW);
		expect(groups.map((g) => g.title)).toEqual([
			"Matura",
			"Pilne",
			"Bez etykiet",
		]);
		expect(groups[0].entries.map((e) => e.board.id)).toEqual(["b1", "b2"]);
		expect(groups[1].entries.map((e) => e.board.id)).toEqual(["b1"]);
		expect(groups[2].entries.map((e) => e.board.id)).toEqual(["b3"]);
	});

	test("groups by date into Polish recency buckets", () => {
		const groups = groupBoards(entries, "date", folders, markers, NOW);
		expect(groups.map((g) => g.title)).toEqual([
			"Dziś",
			"Ostatnie 7 dni",
			"Starsze",
		]);
	});

	test("groups by owner with own boards first", () => {
		const groups = groupBoards(entries, "owner", folders, markers, NOW);
		expect(groups.map((g) => g.title)).toEqual(["Moje tablice", "Od: Ania"]);
	});
});

describe("suggestOrganization (R-121)", () => {
	test("suggests moving unfiled boards to matching existing folder", () => {
		const boards: BoardSummary[] = [
			{
				id: "1",
				name: "Matematyka - całki",
				updatedAt: at("2026-11-24T10:00:00Z"),
			},
			{
				id: "2",
				name: "Matematyka powtórka",
				updatedAt: at("2026-11-23T10:00:00Z"),
			},
		];
		const folders: BoardFolder[] = [
			{ id: "f1", name: "Matematyka", color: "indigo", position: 0 },
		];
		const s = suggestOrganization({ boards, folders, markers: [], now: NOW });
		expect(s[0]).toMatchObject({
			kind: "move-to-folder",
			folderId: "f1",
			boardIds: ["1", "2"],
			boardNames: ["Matematyka - całki", "Matematyka powtórka"],
		});
	});

	test("suggests creating a folder from repeated topics, owner grouping, tutoring markers and archive", () => {
		const boards: BoardSummary[] = [
			{
				id: "1",
				name: "Fizyka - optyka matura",
				updatedAt: at("2026-11-24T10:00:00Z"),
			},
			{
				id: "2",
				name: "Fizyka: mechanika matura",
				updatedAt: at("2026-11-23T10:00:00Z"),
			},
			{
				id: "3",
				name: "Notatki 1",
				owner: "Bartek",
				updatedAt: at("2026-08-01T10:00:00Z"),
			},
			{
				id: "4",
				name: "Notatki 2",
				owner: "Bartek",
				updatedAt: at("2026-08-02T10:00:00Z"),
			},
			{
				id: "5",
				name: "Stare zadania",
				updatedAt: at("2026-07-01T10:00:00Z"),
			},
		];
		const s = suggestOrganization({
			boards,
			folders: [],
			markers: [],
			now: NOW,
			limit: 10,
		});
		expect(
			s.some((x) => x.kind === "create-folder" && x.folderName === "Fizyka"),
		).toBe(true);
		expect(
			s.some((x) => x.kind === "create-folder" && x.folderName === "Bartek"),
		).toBe(true);
		expect(
			s.some((x) => x.kind === "apply-marker" && x.markerName === "Matura"),
		).toBe(true);
		expect(
			s.some((x) => x.kind === "apply-marker" && x.markerName === "Archiwum"),
		).toBe(true);
	});

	test("respects dismissed suggestion ids", () => {
		const boards: BoardSummary[] = [
			{
				id: "1",
				name: "Chemia - kwasy",
				updatedAt: at("2026-11-24T10:00:00Z"),
			},
			{ id: "2", name: "Chemia - sole", updatedAt: at("2026-11-23T10:00:00Z") },
		];
		const first = suggestOrganization({
			boards,
			folders: [],
			markers: [],
			now: NOW,
		});
		expect(first).toHaveLength(1);
		const after = suggestOrganization({
			boards,
			folders: [],
			markers: [],
			now: NOW,
			dismissed: new Set([first[0].id]),
		});
		expect(after).toEqual([]);
	});
});

describe("reordering helpers (R-121)", () => {
	test("moveItem and nudgeItem reorder without mutating", () => {
		const orig = ["a", "b", "c"];
		expect(moveItem(orig, "c", "a")).toEqual(["c", "a", "b"]);
		expect(nudgeItem(orig, "b", -1)).toEqual(["b", "a", "c"]);
		expect(nudgeItem(orig, "a", -1)).toEqual(["a", "b", "c"]);
		expect(orig).toEqual(["a", "b", "c"]);
	});
});
