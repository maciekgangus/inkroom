import { describe, expect, test } from "vitest";
import type { BoardSummary } from "./api";
import { DEFAULT_FILTER, filterBoards, isFiltering } from "./board-filter";

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

	test("isFiltering is true for any change from the default", () => {
		expect(isFiltering(f({ query: "a" }))).toBe(true);
		expect(isFiltering(f({ scope: "mine" }))).toBe(true);
		expect(isFiltering(f({ range: "7" }))).toBe(true);
		expect(isFiltering(f({ sort: "name" }))).toBe(true);
	});
});
