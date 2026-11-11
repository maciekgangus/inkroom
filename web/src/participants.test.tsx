import { render } from "preact";
import { describe, expect, test } from "vitest";
import { cursorColor } from "./cursor-colors";
import { Participants } from "./participants";

const mount = (peers: { id: string; name: string }[], selfId = "me") => {
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
