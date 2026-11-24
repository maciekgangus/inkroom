import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, test, vi } from "vitest";
import { CalendarPage } from "./calendar-page";

const lesson = (over: object) => ({
	id: 1,
	title: "Matma",
	start: "2026-12-01T15:00:00Z",
	end: "2026-12-01T16:00:00Z",
	status: "scheduled",
	teacher: "ola",
	student: "ala",
	role: "teacher",
	note: "",
	homework: "",
	...over,
});

function mount(calendar: object) {
	const calls: string[] = [];
	vi.stubGlobal(
		"fetch",
		vi.fn(async (path: string, init?: RequestInit) => {
			calls.push(`${init?.method ?? "GET"} ${path.split("?")[0]}`);
			const body = path.startsWith("/api/calendar")
				? calendar
				: lesson({ boardId: "0123456789abcdef0123456789abcdef" });
			return new Response(JSON.stringify(body), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		}),
	);
	const root = document.createElement("div");
	document.body.append(root);
	return { root, calls };
}

afterEach(() => {
	vi.unstubAllGlobals();
	document.body.innerHTML = "";
});

describe("CalendarPage", () => {
	test("teacher can create a board for a lesson without one, student sees the link", async () => {
		const { root, calls } = mount({
			lessons: [
				lesson({}),
				lesson({
					id: 2,
					role: "student",
					boardId: "0123456789abcdef0123456789abcdef",
				}),
			],
			unavailable: [],
			requests: [],
		});
		await act(async () => render(<CalendarPage navigate={vi.fn()} />, root));
		await act(async () => {});
		const create = [...root.querySelectorAll("button")].find(
			(b) => b.textContent === "Utwórz tablicę",
		);
		expect(create).toBeTruthy();
		expect(root.querySelector('a[href^="/b/"]')).toBeTruthy();
		await act(async () => create?.click());
		expect(calls).toContain("POST /api/lessons/1/board");
	});

	test("a request from the other side can be accepted", async () => {
		const { root, calls } = mount({
			lessons: [lesson({})],
			unavailable: [],
			requests: [
				{
					id: 7,
					lessonId: 1,
					lessonTitle: "Matma",
					from: "ala",
					mine: false,
					start: "2026-12-03T15:00:00Z",
					end: "2026-12-03T16:00:00Z",
					note: "choroba",
				},
			],
		});
		await act(async () => render(<CalendarPage navigate={vi.fn()} />, root));
		await act(async () => {});
		const accept = [...root.querySelectorAll("button")].find(
			(b) => b.textContent === "Zgódź się",
		);
		await act(async () => accept?.click());
		expect(calls).toContain("POST /api/requests/7/accept");
	});
});
