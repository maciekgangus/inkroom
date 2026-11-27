import { describe, expect, test } from "vitest";
import type { BoardSummary } from "./api";
import {
	DEFAULT_FILTER,
	filterBoards,
	formatSize,
	hasPopoverFilters,
	isFiltering,
	sortDirectionLabel,
} from "./board-filter";

const at = (iso: string) => new Date(iso).toISOString();
const NOW = new Date("2026-11-18T12:00:00");
const boards: BoardSummary[] = [
	{ id: "1", name: "Matematyka klasa 3", updatedAt: at("2026-11-17T10:00:00") },
	{
		id: "2",
		name: "Fizyka",
		updatedAt: at("2026-11-18T08:00:00"),
		owner: "Ania",
	},
	{
		id: "3",
		name: "Chemia",
		updatedAt: at("2026-10-01T09:00:00"),
		owner: "Bartek",
	},
	{ id: "4", name: "angielski", updatedAt: at("2026-11-10T09:00:00") },
];
const ids = (b: BoardSummary[]) => b.map((x) => x.id);
const f = (patch: object) => ({ ...DEFAULT_FILTER, ...patch });

describe("filterBoards (R-091)", () => {
	test("the default filter keeps everything, newest change first", () => {
		expect(ids(filterBoards(boards, DEFAULT_FILTER, NOW))).toEqual([
			"2",
			"1",
			"4",
			"3",
		]);
		expect(isFiltering(DEFAULT_FILTER)).toBe(false);
	});

	test("searches the name regardless of case", () => {
		expect(ids(filterBoards(boards, f({ query: "MATEM" }), NOW))).toEqual([
			"1",
		]);
	});

	test("searches the owner", () => {
		expect(ids(filterBoards(boards, f({ query: "bartek" }), NOW))).toEqual([
			"3",
		]);
	});

	test("searches the date typed as 17.11, as 2026-11 or in full", () => {
		expect(ids(filterBoards(boards, f({ query: "17.11" }), NOW))).toEqual([
			"1",
		]);
		expect(ids(filterBoards(boards, f({ query: "2026-10" }), NOW))).toEqual([
			"3",
		]);
		expect(ids(filterBoards(boards, f({ query: "18.11.2026" }), NOW))).toEqual([
			"2",
		]);
	});

	test("several words must all match, in any field", () => {
		expect(ids(filterBoards(boards, f({ query: "fizyka ania" }), NOW))).toEqual(
			["2"],
		);
		expect(
			ids(filterBoards(boards, f({ query: "fizyka bartek" }), NOW)),
		).toEqual([]);
	});

	test("limits by when the board last changed", () => {
		expect(ids(filterBoards(boards, f({ range: "today" }), NOW))).toEqual([
			"2",
		]);
		expect(ids(filterBoards(boards, f({ range: "7" }), NOW))).toEqual([
			"2",
			"1",
		]);
		expect(ids(filterBoards(boards, f({ range: "30" }), NOW))).toEqual([
			"2",
			"1",
			"4",
		]);
	});

	test("sorts by name, ignoring case and Polish letters' order", () => {
		expect(ids(filterBoards(boards, f({ sort: "name" }), NOW))).toEqual([
			"4",
			"3",
			"2",
			"1",
		]);
	});

	test("does not change the list it is given", () => {
		const copy = [...boards];
		filterBoards(boards, f({ sort: "name" }), NOW);
		expect(boards).toEqual(copy);
	});

	test("isFiltering tracks active search/filter criteria without counting folder navigation", () => {
		expect(isFiltering(f({ query: "a" }))).toBe(true);
		expect(isFiltering(f({ scope: "mine" }))).toBe(true);
		expect(isFiltering(f({ range: "7" }))).toBe(true);
		expect(isFiltering(f({ sort: "name" }))).toBe(true);
		expect(isFiltering(f({ markerIds: ["m1"] }))).toBe(true);
		expect(isFiltering(f({ groupBy: "folder" }))).toBe(true);
		expect(isFiltering(f({ folder: "f1" }))).toBe(false);
		expect(isFiltering(f({ pinnedOnly: true }))).toBe(false);
	});

	test("hasPopoverFilters tracks only the folded filter/sort/group controls", () => {
		expect(hasPopoverFilters(DEFAULT_FILTER)).toBe(false);
		expect(hasPopoverFilters(f({ query: "matma" }))).toBe(false);
		expect(hasPopoverFilters(f({ folder: "f1" }))).toBe(false);
		expect(hasPopoverFilters(f({ range: "7" }))).toBe(true);
		expect(hasPopoverFilters(f({ sort: "name" }))).toBe(true);
		expect(hasPopoverFilters(f({ reversed: true }))).toBe(true);
		expect(hasPopoverFilters(f({ groupBy: "folder" }))).toBe(true);
	});

	test("sortDirectionLabel describes each sort order in Polish", () => {
		expect(sortDirectionLabel("changed", false)).toBe("Od najnowszych");
		expect(sortDirectionLabel("changed", true)).toBe("Od najstarszych");
		expect(sortDirectionLabel("name", false)).toBe("A–Z");
		expect(sortDirectionLabel("name", true)).toBe("Z–A");
		expect(sortDirectionLabel("size", false)).toBe("Od największych");
		expect(sortDirectionLabel("size", true)).toBe("Od najmniejszych");
	});
});

describe("size of a board (R-091)", () => {
	const MB = 1024 * 1024;
	test("formats as 0,4 MB below 10 MB, whole MB above, and <0,1 MB for a tiny one", () => {
		expect(formatSize(0.4 * MB)).toBe("0,4 MB");
		expect(formatSize(9.96 * MB)).toBe("10 MB");
		expect(formatSize(12.4 * MB)).toBe("12 MB");
		expect(formatSize(3000)).toBe("<0,1 MB");
		expect(formatSize(0)).toBe("<0,1 MB");
		expect(formatSize(undefined)).toBe("");
	});

	test("sorts the biggest first by size", () => {
		const sized = [
			{ id: "a", name: "A", updatedAt: at("2026-11-17T10:00:00"), bytes: 100 },
			{ id: "b", name: "B", updatedAt: at("2026-11-16T10:00:00"), bytes: 900 },
			{ id: "c", name: "C", updatedAt: at("2026-11-15T10:00:00") },
		];
		expect(ids(filterBoards(sized, f({ sort: "size" }), NOW))).toEqual([
			"b",
			"a",
			"c",
		]);
	});
});

describe("folders, markers, pins, direction and custom order (R-121)", () => {
	const organized: BoardSummary[] = [
		{
			id: "1",
			name: "Algebra",
			updatedAt: at("2026-11-16T10:00:00"),
			folderId: "f1",
			markerIds: ["m1"],
			position: 2,
		},
		{
			id: "2",
			name: "Geometria",
			updatedAt: at("2026-11-18T10:00:00"),
			folderId: "f1",
			pinned: true,
			markerIds: ["m1", "m2"],
			position: 1,
		},
		{
			id: "3",
			name: "Fizyka",
			updatedAt: at("2026-11-17T10:00:00"),
			position: 3,
		},
	];

	test("pinned boards float to the top of standard sorts", () => {
		expect(ids(filterBoards(organized, f({ sort: "name" }), NOW))).toEqual([
			"2",
			"1",
			"3",
		]);
	});

	test("filters by folder, unfiled, pinnedOnly and markers", () => {
		expect(ids(filterBoards(organized, f({ folder: "f1" }), NOW))).toEqual([
			"2",
			"1",
		]);
		expect(ids(filterBoards(organized, f({ folder: "unfiled" }), NOW))).toEqual(
			["3"],
		);
		expect(ids(filterBoards(organized, f({ pinnedOnly: true }), NOW))).toEqual([
			"2",
		]);
		expect(
			ids(filterBoards(organized, f({ markerIds: ["m1", "m2"] }), NOW)),
		).toEqual(["2"]);
	});

	test("searches folder, marker and co-owner names when present", () => {
		const lookup = {
			folders: [{ id: "f1", name: "Matematyka", position: 0 }],
			markers: [{ id: "m2", name: "Pilne" }],
		};
		const withCoOwners: BoardSummary[] = [
			...organized,
			{
				id: "4",
				name: "Wspólna tablica",
				updatedAt: at("2026-11-18T11:00:00"),
				owners: ["maciek", "kasia.k"],
			},
		];
		expect(
			ids(filterBoards(organized, f({ query: "pilne" }), NOW, lookup)),
		).toEqual(["2"]);
		expect(
			ids(filterBoards(organized, f({ query: "matematyka" }), NOW, lookup)),
		).toEqual(["2", "1"]);
		expect(
			ids(filterBoards(withCoOwners, f({ query: "kasia" }), NOW, lookup)),
		).toEqual(["4"]);
	});

	test("supports reversed sort direction and custom manual order", () => {
		expect(ids(filterBoards(organized, f({ sort: "custom" }), NOW))).toEqual([
			"2",
			"1",
			"3",
		]);
		expect(
			ids(filterBoards(organized, f({ sort: "custom", reversed: true }), NOW)),
		).toEqual(["3", "1", "2"]);
	});
});
