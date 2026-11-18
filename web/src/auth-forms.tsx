import { useEffect, useState } from "preact/hooks";
import * as api from "./api";
import { Captcha } from "./captcha";
import { Logo } from "./logo";

/** What the server answered after a visit to Google: `?google=denied` or `?google=error` (R-063). */
const GOOGLE_NOTICES: Record<string, string> = {
	denied: "Logowanie przez Google zostało anulowane.",
	error: "Nie udało się zalogować przez Google. Spróbuj jeszcze raz.",
};

/** The link that starts signing in with Google; shown only when the server has it (R-063). */
function GoogleLink({ enabled }: { enabled: boolean }) {
	if (!enabled) return null;
	return (
		<a class="google-link" href="/api/auth/google/start">
			<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
				<title>Google</title>
				<path
					fill="#4285F4"
					d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.8z"
				/>
				<path
					fill="#34A853"
					d="M12 24c3.2 0 6-1.1 7.9-2.9l-3.9-3c-1.1.7-2.5 1.2-4 1.2-3.1 0-5.7-2.1-6.7-4.9H1.3v3.1A12 12 0 0 0 12 24z"
				/>
				<path
					fill="#FBBC05"
					d="M5.3 14.4a7.2 7.2 0 0 1 0-4.8V6.5H1.3a12 12 0 0 0 0 10.9l4-3z"
				/>
				<path
					fill="#EA4335"
					d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.5l4 3.1C6.3 6.9 8.9 4.8 12 4.8z"
				/>
			</svg>
			Kontynuuj z Google
		</a>
	);
}

/** Asks the server whether Google sign-in is on; a failed answer means off. */
function useGoogle(): boolean {
	const [on, setOn] = useState(false);
	useEffect(() => {
		api.config().then(
			(c) => setOn(c.google === true),
			() => setOn(false),
		);
	}, []);
	return on;
}

interface LoginProps {
	onAuth: (account: api.Account) => void;
	navigate: (to: string) => void;
	/** The query string of the page, for the notice after a visit to Google. */
	search?: string;
}

/** The login page: an e-mail or a username and a password (R-055). */
export function AuthForms({ onAuth, navigate, search = "" }: LoginProps) {
	const notice =
		GOOGLE_NOTICES[new URLSearchParams(search).get("google") ?? ""];
	const [error, setError] = useState(notice ?? "");
	const [busy, setBusy] = useState(false);
	const google = useGoogle();

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
				<GoogleLink enabled={google} />
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
	const [google, setGoogle] = useState(false);

	useEffect(() => {
		api.config().then(
			(c) => {
				setSiteKey(c.turnstileSiteKey);
				setGoogle(c.google === true);
			},
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
				<p class="muted">
					{google
						? "Rejestracja e-mailem jest chwilowo niedostępna."
						: "Rejestracja jest chwilowo niedostępna."}
				</p>
				<GoogleLink enabled={google} />
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
				<GoogleLink enabled={google} />
			</form>
		</main>
	);
}
