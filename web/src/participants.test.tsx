import { render } from "preact";
import { describe, expect, test, vi } from "vitest";
import { cursorColor } from "./cursor-colors";
import { Participants } from "./participants";

const mount = (
	peers: { id: string; name: string; avatar?: string; recording?: boolean }[],
	selfId = "me",
) => {
	const root = document.createElement("div");
	render(<Participants peers={peers} selfId={selfId} />, root);
	return root;
};
const chips = (root: HTMLElement) => [...root.querySelectorAll(".participant")];

describe("Participants (R-046)", () => {
	test("shows nothing when nobody is listed", () => {
		expect(mount([]).querySelector(".participants")).toBeNull();
	});

	test("one chip per person with the first letter of the name", () => {
		const root = mount([
			{ id: "a1", name: "Ann" },
			{ id: "b1", name: "bob" },
		]);
		expect(chips(root).map((c) => c.textContent)).toEqual(["A", "B"]);
	});

	test("a person with a known avatar shows the picture instead of the letter (R-111)", () => {
		const root = mount([
			{ id: "a1", name: "Ann", avatar: "fox" },
			{ id: "b1", name: "Bob", avatar: "../../evil" },
		]);
		const [ann, bob] = chips(root);
		expect(ann.querySelector("img")?.getAttribute("src")).toBe(
			"/avatars/fox.svg",
		);
		expect(ann.textContent).toBe("");
		// An id that is not on the list is not used in an address: the letter stays.
		expect(bob.querySelector("img")).toBeNull();
		expect(bob.textContent).toBe("B");
	});

	test("the name is the tooltip and the accessible name", () => {
		const root = mount([{ id: "a1", name: "Ann" }]);
		const chip = chips(root)[0] as HTMLElement;
		expect(chip.title).toBe("Ann");
		expect(chip.getAttribute("aria-label")).toBe("Ann");
	});

	test("you come first, marked as you", () => {
		const root = mount(
			[
				{ id: "a1", name: "Ann" },
				{ id: "me", name: "Maciek" },
			],
			"me",
		);
		const [first] = chips(root) as HTMLElement[];
		expect(first.textContent).toBe("M");
		expect(first.title).toBe("Maciek (Ty)");
		expect(first.classList.contains("self")).toBe(true);
	});

	test("each person has the colour of their cursor", () => {
		const root = mount([{ id: "a1", name: "Ann" }]);
		const chip = chips(root)[0] as HTMLElement;
		expect(chip.style.background).not.toBe("");
		expect(chip.dataset.color).toBe(cursorColor("a1"));
	});

	test("a long list is cut and the rest is counted", () => {
		const peers = Array.from({ length: 9 }, (_, i) => ({
			id: `p${i}`,
			name: `Osoba ${i}`,
		}));
		const root = mount(peers, "p0");
		expect(chips(root)).toHaveLength(5);
		const more = root.querySelector(".participants-more") as HTMLElement;
		expect(more.textContent).toBe("+4");
		expect(more.title).toContain("Osoba 8");
	});

	test("a name without a letter still gets a chip", () => {
		const root = mount([{ id: "x", name: "123" }]);
		expect(chips(root)[0].textContent).toBe("1");
		const root2 = mount([{ id: "y", name: "" }]);
		expect(chips(root2)[0].textContent).toBe("?");
	});

	test("the full name is on the chip for a tooltip that shows at once", () => {
		const root = mount([
			{ id: "a1", name: "Anna Kowalska-Nowak" },
			{ id: "me", name: "Maciek" },
		]);
		const names = chips(root).map((c) => (c as HTMLElement).dataset.name);
		expect(names).toEqual(["Maciek (Ty)", "Anna Kowalska-Nowak"]);
	});

	test("the counter lists the people it hides", () => {
		const peers = Array.from({ length: 7 }, (_, i) => ({
			id: `p${i}`,
			name: `Osoba ${i}`,
		}));
		const more = mount(peers, "p0").querySelector(
			".participants-more",
		) as HTMLElement;
		expect(more.dataset.name).toBe("Osoba 5, Osoba 6");
	});
});

describe("Participants: drawing rights (R-016)", () => {
	const people = [
		{ id: "me", name: "Own" },
		{ id: "a1", name: "Ann", muted: true },
		{ id: "b1", name: "Bob" },
	];
	const open = (onSelect: (id: string) => void, canManage: boolean) => {
		const root = document.createElement("div");
		render(
			<Participants
				peers={people}
				selfId="me"
				onSelect={canManage ? (p) => onSelect(p.id) : undefined}
			/>,
			root,
		);
		return root;
	};

	test("a person who may not draw has a mark", () => {
		const root = open(() => {}, true);
		const marked = [...root.querySelectorAll(".participant.muted")];
		expect(marked.map((c) => c.getAttribute("data-name"))).toEqual(["Ann"]);
	});

	test("the owner can press another person's chip, but not their own", () => {
		const picked: string[] = [];
		const root = open((id) => picked.push(id), true);
		for (const c of chips(root)) (c as HTMLElement).click();
		expect(picked).toEqual(["a1", "b1"]);
	});

	test("without the right to manage nothing can be pressed", () => {
		const picked: string[] = [];
		const root = open((id) => picked.push(id), false);
		for (const c of chips(root)) (c as HTMLElement).click();
		expect(picked).toEqual([]);
		expect(root.querySelector("button.participant")).toBeNull();
	});
});

describe("Participants: colours and shape", () => {
	test("two people never share a colour when the board assigns them", () => {
		const root = document.createElement("div");
		const colors = new Map([
			["a1", "#111111"],
			["b1", "#222222"],
		]);
		render(
			<Participants
				peers={[
					{ id: "a1", name: "Ann" },
					{ id: "b1", name: "Bob" },
				]}
				selfId="a1"
				colors={colors}
				onSelect={() => {}}
			/>,
			root,
		);
		expect(
			[...root.querySelectorAll(".participant")].map(
				(c) => (c as HTMLElement).dataset.color,
			),
		).toEqual(["#111111", "#222222"]);
	});

	describe("following (R-093)", () => {
		const peers = [
			{ id: "me", name: "Ola" },
			{ id: "a1", name: "Ann" },
		];

		test("with a handler, pressing another person's chip calls it; our own chip is not pressable", () => {
			const root = document.createElement("div");
			const onFollow = vi.fn();
			render(
				<Participants peers={peers} selfId="me" onFollow={onFollow} />,
				root,
			);
			const buttons = root.querySelectorAll("button.participant");
			expect(buttons).toHaveLength(1);
			(buttons[0] as HTMLButtonElement).click();
			expect(onFollow).toHaveBeenCalledWith(peers[1]);
		});

		test("the chip of the person we follow is marked", () => {
			const root = document.createElement("div");
			render(
				<Participants
					peers={peers}
					selfId="me"
					onFollow={() => {}}
					following="a1"
				/>,
				root,
			);
			expect(root.querySelector(".participant.following")?.textContent).toBe(
				"A",
			);
			expect(root.querySelectorAll(".participant.following")).toHaveLength(1);
		});

		test("the owner's handler for the menu wins over following", () => {
			const root = document.createElement("div");
			const onSelect = vi.fn();
			const onFollow = vi.fn();
			render(
				<Participants
					peers={peers}
					selfId="me"
					onSelect={onSelect}
					onFollow={onFollow}
				/>,
				root,
			);
			(root.querySelector("button.participant") as HTMLButtonElement).click();
			expect(onSelect).toHaveBeenCalledOnce();
			expect(onFollow).not.toHaveBeenCalled();
		});
	});

	test("a red dot says the lesson is being recorded, for everyone (R-094)", () => {
		const root = mount([
			{ id: "a1", name: "Ann", recording: true },
			{ id: "me", name: "Maciek" },
		]);
		const dot = root.querySelector("[role='status']") as HTMLElement;
		expect(dot.getAttribute("aria-label")).toBe("Trwa nagrywanie");
		expect(dot.title).toBe("Trwa nagrywanie");
		expect(dot.querySelector(".rec-dot")).not.toBeNull();
	});

	test("no dot when nobody records", () => {
		const root = mount([{ id: "a1", name: "Ann" }]);
		expect(root.querySelector("[role='status']")).toBeNull();
	});
});
