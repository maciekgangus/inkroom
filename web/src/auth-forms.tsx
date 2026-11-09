import { useState } from "preact/hooks";
import * as api from "./api";

/** E-mail and password form with login and register buttons. */
export function AuthForms({ onAuth }: { onAuth: (email: string) => void }) {
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);

	const run = async (form: HTMLFormElement, action: typeof api.login) => {
		const data = new FormData(form);
		setBusy(true);
		setError("");
		try {
			onAuth(
				await action(
					String(data.get("email") ?? ""),
					String(data.get("password") ?? ""),
				),
			);
		} catch (e) {
			setError(e instanceof Error ? e.message : "Błąd");
			setBusy(false);
		}
	};

	return (
		<main class="center">
			<h1>Inkroom</h1>
			<form
				class="stack"
				onSubmit={(e) => {
					e.preventDefault();
					run(e.currentTarget as HTMLFormElement, api.login);
				}}
			>
				<input
					name="email"
					type="email"
					placeholder="E-mail"
					autocomplete="email"
					required
				/>
				<input
					name="password"
					type="password"
					placeholder="Hasło (min. 8 znaków)"
					autocomplete="current-password"
					required
				/>
				{error && (
					<p class="error" role="alert">
						{error}
					</p>
				)}
				<div class="row">
					<button
						type="button"
						class="primary"
						disabled={busy}
						onClick={(e) =>
							run(
								(e.currentTarget as HTMLButtonElement).form as HTMLFormElement,
								api.login,
							)
						}
					>
						Zaloguj
					</button>
					<button
						type="button"
						disabled={busy}
						onClick={(e) =>
							run(
								(e.currentTarget as HTMLButtonElement).form as HTMLFormElement,
								api.register,
							)
						}
					>
						Zarejestruj
					</button>
				</div>
			</form>
		</main>
	);
}
