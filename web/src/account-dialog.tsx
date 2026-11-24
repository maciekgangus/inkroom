import { useEffect, useRef, useState } from "preact/hooks";
import type { Account } from "./api";
import * as api from "./api";
import { AVATARS, avatarUrl } from "./avatars";
import { Icon } from "./icon";

const FOCUSABLE =
	'button:not(:disabled), input:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])';

/** The Google "G", the same mark as on the sign-in pages. */
function GoogleMark() {
	return (
		<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
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
	);
}

/** A password field with an eye that shows or hides what was typed. */
function PasswordField({
	name,
	label,
	autoComplete,
	value,
	onInput,
}: {
	name: string;
	label: string;
	autoComplete: string;
	value: string;
	onInput: (value: string) => void;
}) {
	const [shown, setShown] = useState(false);
	return (
		<div class="account-field">
			<input
				// Preact types "password" and "text" as separate input shapes; both are plain inputs here.
				type={(shown ? "text" : "password") as "text"}
				name={name}
				placeholder={label}
				aria-label={label}
				autoComplete={autoComplete}
				value={value}
				onInput={(e) => onInput(e.currentTarget.value)}
			/>
			<button
				type="button"
				class="eye icon"
				aria-label={shown ? "Ukryj hasło" : "Pokaż hasło"}
				aria-pressed={shown}
				title={shown ? "Ukryj hasło" : "Pokaż hasło"}
				onClick={() => setShown(!shown)}
			>
				<Icon name="eye" />
			</button>
		</div>
	);
}

/**
 * The account window (R-085): who is logged in, how they sign in, a new password (for accounts
 * that have one) and deleting the account, which asks for the username and cannot be undone.
 * Escape and the cross close it, Tab stays inside it.
 */
export function AccountDialog({
	account,
	onClose,
	onDeleted,
	onAvatar,
}: {
	account: Account;
	onClose: () => void;
	/** Called once the account is gone; the caller goes back to the logged-out screen. */
	onDeleted: () => void;
	/** Called with the picture once it is saved ("" for none, R-111). */
	onAvatar?: (avatar: string) => void;
}) {
	const hasPassword = account.hasPassword !== false;
	const [current, setCurrent] = useState("");
	const [next, setNext] = useState("");
	const [note, setNote] = useState("");
	const [error, setError] = useState("");
	const [deleting, setDeleting] = useState(false);
	const [picking, setPicking] = useState(false);
	const picture = avatarUrl(account.avatar);
	const [confirm, setConfirm] = useState("");
	const dialog = useRef<HTMLDivElement>(null);

	// Focus goes into the window and returns to where it came from.
	useEffect(() => {
		const before = document.activeElement as HTMLElement | null;
		dialog.current?.focus();
		return () => before?.focus?.();
	}, []);

	// Escape works wherever the focus is (it may be on the page when a button it was on went away).
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [onClose]);

	// Opening the danger zone puts the cursor in the name field, so typing starts at once.
	useEffect(() => {
		if (deleting)
			dialog.current
				?.querySelector<HTMLInputElement>("input[name=confirm]")
				?.focus();
	}, [deleting]);

	const keys = (e: KeyboardEvent) => {
		if (e.key !== "Tab" || !dialog.current) return;
		const items = [...dialog.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
		if (items.length === 0) return;
		const first = items[0];
		const last = items[items.length - 1];
		const active = document.activeElement;
		if (e.shiftKey && (active === first || active === dialog.current)) {
			e.preventDefault();
			last.focus();
		} else if (!e.shiftKey && active === last) {
			e.preventDefault();
			first.focus();
		}
	};

	const changePassword = async () => {
		setNote("");
		setError("");
		try {
			await api.changePassword(current, next);
			setCurrent("");
			setNext("");
			setNote("Hasło zmienione");
		} catch (e) {
			setError(api.errorMessage(e));
		}
	};
	const chooseAvatar = async (avatar: string) => {
		setNote("");
		setError("");
		try {
			await api.setAvatar(avatar);
			onAvatar?.(avatar);
			setPicking(false);
		} catch (e) {
			setError(api.errorMessage(e));
		}
	};
	const remove = async () => {
		setError("");
		try {
			await api.deleteAccount(confirm.trim());
			onDeleted();
		} catch (e) {
			setError(api.errorMessage(e));
		}
	};
	const matches =
		confirm.trim().toLowerCase() === account.username.toLowerCase();
	const tooShort = next.length > 0 && next.length < 8;

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: the backdrop only closes on a click outside; Escape and the cross are the keyboard ways.
		<div
			class="shortcuts-backdrop"
			role="presentation"
			onMouseDown={(e) => {
				if (e.target === e.currentTarget) onClose();
			}}
		>
			<div
				ref={dialog}
				class="shortcuts-dialog account-dialog"
				role="dialog"
				aria-modal="true"
				aria-label="Konto"
				tabIndex={-1}
				onKeyDown={keys}
			>
				<div class="account-head">
					<span class="account-title">Konto</span>
					<button
						type="button"
						class="account-close icon"
						aria-label="Zamknij"
						title="Zamknij"
						onClick={onClose}
					>
						<Icon name="close" />
					</button>
				</div>

				<div class="account-who">
					<button
						type="button"
						class="account-avatar"
						aria-label={picture ? "Zmień awatar" : "Wybierz awatar"}
						title={picture ? "Zmień awatar" : "Wybierz awatar"}
						aria-expanded={picking}
						onClick={() => setPicking(!picking)}
					>
						{picture ? (
							<img src={picture} alt="" />
						) : (
							account.username.charAt(0).toUpperCase()
						)}
						<span class="account-avatar-edit" aria-hidden="true">
							<Icon name="pen" />
						</span>
					</button>
					<div class="account-id">
						<strong>{account.username}</strong>
						{account.email && <span class="muted">{account.email}</span>}
					</div>
					<span class="account-method">
						{hasPassword ? <Icon name="lock" /> : <GoogleMark />}
						{hasPassword ? "Hasło" : "Konto Google"}
					</span>
				</div>

				{picking && (
					<div class="avatar-grid" role="group" aria-label="Awatary">
						<button
							type="button"
							aria-label="Bez awatara"
							title="Bez awatara (pierwsza litera)"
							aria-pressed={!picture}
							onClick={() => chooseAvatar("")}
						>
							<span class="avatar-letter" aria-hidden="true">
								{account.username.charAt(0).toUpperCase()}
							</span>
						</button>
						{AVATARS.map((a) => (
							<button
								key={a.id}
								type="button"
								aria-label={a.label}
								title={a.label}
								aria-pressed={account.avatar === a.id}
								onClick={() => chooseAvatar(a.id)}
							>
								<img src={`/avatars/${a.id}.svg`} alt="" loading="lazy" />
							</button>
						))}
					</div>
				)}

				{hasPassword && (
					<form
						class="password-form account-section"
						onSubmit={(e) => {
							e.preventDefault();
							changePassword();
						}}
					>
						<h3 class="account-label">Zmiana hasła</h3>
						<PasswordField
							name="current"
							label="Obecne hasło"
							autoComplete="current-password"
							value={current}
							onInput={setCurrent}
						/>
						<PasswordField
							name="new"
							label="Nowe hasło"
							autoComplete="new-password"
							value={next}
							onInput={setNext}
						/>
						{tooShort && (
							<p class="field-hint">Nowe hasło ma mieć co najmniej 8 znaków</p>
						)}
						<button
							type="submit"
							class="primary"
							disabled={!current || next.length < 8}
						>
							Zmień hasło
						</button>
					</form>
				)}
				{note && (
					<p class="account-note">
						<Icon name="check" />
						{note}
					</p>
				)}
				{error && (
					<p class="shortcut-error" role="alert">
						{error}
					</p>
				)}

				<div class="account-section account-zone">
					<h3 class="account-label">Strefa zagrożenia</h3>
					{deleting ? (
						<div class="delete-confirm">
							<p class="account-warning">
								<Icon name="alert" />
								<span>
									Skasuje to konto, wszystkie Twoje tablice i sesje. To jest
									nieodwracalne. Wpisz nazwę konta ({account.username}), żeby
									potwierdzić.
								</span>
							</p>
							<input
								name="confirm"
								placeholder={account.username}
								aria-label="Nazwa konta do potwierdzenia"
								autoComplete="off"
								value={confirm}
								onInput={(e) => setConfirm(e.currentTarget.value)}
							/>
							<div class="account-actions">
								<button
									type="button"
									onClick={() => {
										setDeleting(false);
										setConfirm("");
									}}
								>
									Anuluj
								</button>
								<button
									type="button"
									class="danger"
									disabled={!matches}
									onClick={remove}
								>
									Usuń na zawsze
								</button>
							</div>
						</div>
					) : (
						<button
							type="button"
							class="danger-outline"
							onClick={() => setDeleting(true)}
						>
							<Icon name="trash" />
							Usuń konto…
						</button>
					)}
				</div>
			</div>
		</div>
	);
}
