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

	test("the cross closes and there is no lone Close button", async () => {
		await show();
		expect(byText("Zamknij")).toBeUndefined();
		await act(async () =>
			q<HTMLButtonElement>("button[aria-label=Zamknij]")?.click(),
		);
		expect(onClose).toHaveBeenCalled();
	});

	test("Escape closes the window wherever the focus is", async () => {
		await show();
		await act(async () => {
			document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
		});
		expect(onClose).toHaveBeenCalled();
	});

	test("shows an avatar with the initial and a pill with the sign-in method", async () => {
		await show();
		expect(q(".account-avatar")?.textContent).toBe("A");
		expect(q(".account-method")?.textContent).toContain("Hasło");
		render(null, root);
		await show(false);
		expect(q(".account-method")?.textContent).toContain("Google");
	});

	test("choosing an avatar saves it at once and reports it (R-111)", async () => {
		const onAvatar = vi.fn<(avatar: string) => void>();
		await act(async () =>
			render(
				<AccountDialog
					account={{ email: "ann@example.com", username: "ann" }}
					onClose={onClose}
					onDeleted={onDeleted}
					onAvatar={onAvatar}
				/>,
				root,
			),
		);
		expect(q(".avatar-grid")).toBeNull();
		await act(async () =>
			q<HTMLButtonElement>(
				".account-avatar[aria-label='Wybierz awatar']",
			)?.click(),
		);
		const fox = q<HTMLButtonElement>(".avatar-grid button[aria-label='Lis']");
		expect(fox).not.toBeNull();
		await act(async () => fox?.click());
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe("/api/account/avatar");
		expect(init.method).toBe("PUT");
		expect(JSON.parse(init.body)).toEqual({ avatar: "fox" });
		expect(onAvatar).toHaveBeenCalledWith("fox");
		// Chosen: the grid folds away.
		expect(q(".avatar-grid")).toBeNull();
	});

	test("an account with an avatar shows its picture, and it can go back to the letter (R-111)", async () => {
		const onAvatar = vi.fn<(avatar: string) => void>();
		await act(async () =>
			render(
				<AccountDialog
					account={{ email: "ann@example.com", username: "ann", avatar: "owl" }}
					onClose={onClose}
					onDeleted={onDeleted}
					onAvatar={onAvatar}
				/>,
				root,
			),
		);
		expect(q(".account-avatar img")?.getAttribute("src")).toBe(
			"/avatars/owl.svg",
		);
		await act(async () =>
			q<HTMLButtonElement>(
				".account-avatar[aria-label='Zmień awatar']",
			)?.click(),
		);
		await act(async () =>
			q<HTMLButtonElement>(
				".avatar-grid button[aria-label='Bez awatara']",
			)?.click(),
		);
		expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ avatar: "" });
		expect(onAvatar).toHaveBeenCalledWith("");
	});

	test("the password button waits for a valid form and the hint says why", async () => {
		await show();
		const button = () =>
			q<HTMLButtonElement>("form.password-form button[type=submit]");
		expect(button()?.disabled).toBe(true);
		await type("input[name=current]", "old-password");
		await type("input[name=new]", "short");
		expect(button()?.disabled).toBe(true);
		expect(q(".field-hint")?.textContent).toContain("8");
		await type("input[name=new]", "long-enough-1");
		expect(button()?.disabled).toBe(false);
		expect(q(".field-hint")).toBeNull();
	});

	test("the eye shows and hides a password", async () => {
		await show();
		const eye = q<HTMLButtonElement>("input[name=new] + button.eye");
		expect(q<HTMLInputElement>("input[name=new]")?.type).toBe("password");
		await act(async () => eye?.click());
		expect(q<HTMLInputElement>("input[name=new]")?.type).toBe("text");
		await act(async () =>
			q<HTMLButtonElement>("input[name=new] + button.eye")?.click(),
		);
		expect(q<HTMLInputElement>("input[name=new]")?.type).toBe("password");
	});

	test("the danger zone is folded until asked and can be cancelled", async () => {
		await show();
		expect(q("input[name=confirm]")).toBeNull();
		expect(root.textContent).toContain("Strefa zagrożenia");
		await act(async () => byText("Usuń konto")?.click());
		expect(q("input[name=confirm]")).not.toBeNull();
		await act(async () => byText("Anuluj")?.click());
		expect(q("input[name=confirm]")).toBeNull();
	});

	test("the delete button always has a label that differs from its background", async () => {
		await show();
		const open = byText("Usuń konto") as HTMLButtonElement;
		expect(open.textContent?.trim().length).toBeGreaterThan(0);
		expect(open.classList.contains("danger")).toBe(false);
	});
});
