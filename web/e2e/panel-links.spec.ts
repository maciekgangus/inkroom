import { expect, test } from "@playwright/test";
import { E2E_LOGIN } from "./helpers";

// A board opens by a click on its name or its picture, but it must not look like a link: no
// underline and the colour of the text round it, in a list and in tiles.
for (const view of ["list", "tiles"]) {
	test(`in the ${view} the name of a board does not look like a link`, async ({
		page,
	}) => {
		const req = page.context().request;
		await req.post("/api/login", { data: E2E_LOGIN });
		await req.post("/api/boards", { data: { name: "Wyglad linku" } });
		await page.addInitScript(
			(v) => localStorage.setItem("inkroom.boardView", v),
			view,
		);
		await page.goto("/");
		await page.waitForSelector(".boards .board a.open-link");

		const look = await page.evaluate(() => {
			const a = document.querySelector(
				".boards .board a.open-link",
			) as HTMLElement;
			const name = a.querySelector(".name") ?? a;
			const s = getComputedStyle(name);
			return {
				underline: s.textDecorationLine,
				color: s.color,
				body: getComputedStyle(document.body).color,
				linkUnderline: getComputedStyle(a).textDecorationLine,
				linkColor: getComputedStyle(a).color,
			};
		});
		expect(look.underline).toBe("none");
		expect(look.linkUnderline).toBe("none");
		expect(look.color).toBe(look.body);
		expect(look.linkColor).toBe(look.body);
	});
}
