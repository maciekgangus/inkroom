import { useEffect, useState } from "preact/hooks";
import * as api from "./api";
import { Captcha } from "./captcha";
import { Logo } from "./logo";

interface LoginProps {
	onAuth: (account: api.Account) => void;
	navigate: (to: string) => void;
}

/** The login page: an e-mail or a username and a password (R-055). */
export function AuthForms({ onAuth, navigate }: LoginProps) {
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);

	const run = async (form: HTMLFormElement) => {
		const data = new FormData(form);
		setBusy(true);
		setError("");
		try {
			onAuth(
				await api.login(
					String(data.get("login") ?? ""),
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
			<h1 class="brand">
				<Logo height={44} />
			</h1>
			<form
				class="stack"
				onSubmit={(e) => {
					e.preventDefault();
					run(e.currentTarget as HTMLFormElement);
				}}
			>
				<input
					name="login"
					type="text"
					placeholder="E-mail lub nazwa użytkownika"
					autocomplete="username"
					required
				/>
				<input
					name="password"
					type="password"
					placeholder="Hasło"
					autocomplete="current-password"
					required
				/>
				{error && (
					<p class="error" role="alert">
						{error}
					</p>
				)}
				<div class="row">
					<button type="submit" class="primary" disabled={busy}>
						Zaloguj
					</button>
					<button type="button" onClick={() => navigate("/register")}>
						Załóż konto
					</button>
				</div>
			</form>
		</main>
	);
}

interface RegisterProps {
	navigate: (to: string) => void;
}

/** The registration page (/register): e-mail, username, password and the captcha (R-054). */
export function RegisterPage({ navigate }: RegisterProps) {
	// undefined: asking the server; "": no captcha configured, so registration is closed.
	const [siteKey, setSiteKey] = useState<string | undefined>(undefined);
	const [token, setToken] = useState("");
	const [attempt, setAttempt] = useState(0);
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		api.config().then(
			(c) => setSiteKey(c.turnstileSiteKey),
			() => setSiteKey(""),
		);
	}, []);

	const submit = async (form: HTMLFormElement) => {
		if (!token) return;
		const data = new FormData(form);
		setBusy(true);
		setError("");
		try {
			await api.register({
				email: String(data.get("email") ?? ""),
				username: String(data.get("username") ?? ""),
				password: String(data.get("password") ?? ""),
				captcha: token,
			});
			navigate("/"); // the server has logged the new account in
		} catch (e) {
			setError(e instanceof Error ? e.message : "Błąd");
			setToken(""); // a token works once: the widget starts over
			setAttempt((a) => a + 1);
			setBusy(false);
		}
	};

	if (siteKey === undefined) return null;
	if (siteKey === "") {
		return (
			<main class="center">
				<h1 class="brand">
					<Logo height={44} />
				</h1>
				<p class="muted">Rejestracja jest chwilowo niedostępna.</p>
				<button type="button" onClick={() => navigate("/")}>
					Mam już konto
				</button>
			</main>
		);
	}
	return (
		<main class="center">
			<h1 class="brand">
				<Logo height={44} />
			</h1>
			<form
				class="stack"
				onSubmit={(e) => {
					e.preventDefault();
					submit(e.currentTarget as HTMLFormElement);
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
					name="username"
					type="text"
					placeholder="Nazwa użytkownika (3-24 znaki: a-z, 0-9, . _ -)"
					autocomplete="username"
					minLength={3}
					maxLength={24}
					pattern="[A-Za-z0-9._-]+"
					required
				/>
				<input
					name="password"
					type="password"
					placeholder="Hasło (min. 8 znaków)"
					autocomplete="new-password"
					minLength={8}
					required
				/>
				<Captcha siteKey={siteKey} onToken={setToken} attempt={attempt} />
				{error && (
					<p class="error" role="alert">
						{error}
					</p>
				)}
				<div class="row">
					<button type="submit" class="primary" disabled={busy || !token}>
						Załóż konto
					</button>
					<button type="button" onClick={() => navigate("/")}>
						Mam już konto
					</button>
				</div>
			</form>
		</main>
	);
}
