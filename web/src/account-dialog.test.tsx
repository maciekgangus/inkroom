import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { AccountDialog } from "./account-dialog";

describe("AccountDialog (R-085)", () => {
	const root = document.createElement("div");
	let fetchMock: ReturnType<typeof vi.fn>;
	let onClose: ReturnType<typeof vi.fn<() => void>>;
	let onDeleted: ReturnType<typeof vi.fn<() => void>>;
	const q = <T extends Element>(s: string) => root.querySelector(s) as T | null;
	const byText = (text: string) =>
		[...root.querySelectorAll("button")].find((b) =>
			b.textContent?.includes(text),
		) as HTMLButtonElement | undefined;
	const type = async (selector: string, value: string) => {
		const input = q<HTMLInputElement>(selector) as HTMLInputElement;
		input.value = value;
		await act(async () => {
			input.dispatchEvent(new Event("input", { bubbles: true }));
		});
	};
	const show = async (hasPassword = true) => {
		await act(async () =>
			render(
				<AccountDialog
					account={{ email: "ann@example.com", username: "ann", hasPassword }}
					onClose={onClose}
					onDeleted={onDeleted}
				/>,
				root,
			),
		);
	};

	beforeEach(() => {
		onClose = vi.fn<() => void>();
		onDeleted = vi.fn<() => void>();
		fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
		vi.stubGlobal("fetch", fetchMock);
	});
	afterEach(() => {
		render(null, root);
		vi.unstubAllGlobals();
	});

	test("shows the name, the e-mail and how the account signs in", async () => {
		await show();
		expect(root.textContent).toContain("ann@example.com");
		expect(root.textContent).toContain("ann");
		expect(root.textContent).toContain("hasło");
		render(null, root);
		await show(false);
		expect(root.textContent).toContain("Google");
		expect(q("input[type=password]")).toBeNull();
	});

	test("deleting asks for the username and says it cannot be undone", async () => {
		await show();
		await act(async () => byText("Usuń konto")?.click());
		expect(root.textContent).toContain("nieodwracalne");
		const confirm = byText("Usuń na zawsze") as HTMLButtonElement;
		expect(confirm.disabled).toBe(true);
		await type("input[name=confirm]", "ann");
		expect((byText("Usuń na zawsze") as HTMLButtonElement).disabled).toBe(
			false,
		);
		await act(async () => {
			(byText("Usuń na zawsze") as HTMLButtonElement).click();
			await new Promise((r) => setTimeout(r, 10));
		});
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe("/api/account/delete");
		expect(JSON.parse(init.body)).toEqual({ confirm: "ann" });
		expect(onDeleted).toHaveBeenCalled();
	});

	test("a wrong name does not enable deleting", async () => {
		await show();
		await act(async () => byText("Usuń konto")?.click());
		await type("input[name=confirm]", "bob");
		expect((byText("Usuń na zawsze") as HTMLButtonElement).disabled).toBe(true);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	test("changes the password and says so", async () => {
		await show();
		await type("input[name=current]", "password1");
		await type("input[name=new]", "newpassword1");
		await act(async () => {
			q<HTMLFormElement>("form.password-form")?.dispatchEvent(
				new Event("submit", { bubbles: true, cancelable: true }),
			);
			await new Promise((r) => setTimeout(r, 10));
		});
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe("/api/account/password");
		expect(JSON.parse(init.body)).toEqual({
			current: "password1",
			new: "newpassword1",
		});
		expect(root.textContent).toContain("Hasło zmienione");
	});

	test("shows the server's reason when the password is refused", async () => {
		fetchMock.mockResolvedValue(
			new Response('{"error":"Obecne hasło jest nieprawidłowe"}', {
				status: 403,
			}),
		);
		await show();
		await type("input[name=current]", "x");
		await type("input[name=new]", "newpassword1");
		await act(async () => {
			q<HTMLFormElement>("form.password-form")?.dispatchEvent(
				new Event("submit", { bubbles: true, cancelable: true }),
			);
			await new Promise((r) => setTimeout(r, 10));
		});
		expect(q("[role=alert]")?.textContent).toContain("nieprawidłowe");
	});

	test("Close closes", async () => {
		await show();
		await act(async () => byText("Zamknij")?.click());
		expect(onClose).toHaveBeenCalled();
	});
});
