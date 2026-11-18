import { useState } from "preact/hooks";
import type { Account } from "./api";
import * as api from "./api";

/**
 * The account window (R-085): who is logged in, how they sign in, a new password (for accounts
 * that have one) and deleting the account, which asks for the username and cannot be undone.
 */
export function AccountDialog({
	account,
	onClose,
	onDeleted,
}: {
	account: Account;
	onClose: () => void;
	/** Called once the account is gone; the caller goes back to the logged-out screen. */
	onDeleted: () => void;
}) {
	const hasPassword = account.hasPassword !== false;
	const [current, setCurrent] = useState("");
	const [next, setNext] = useState("");
	const [note, setNote] = useState("");
	const [error, setError] = useState("");
	const [deleting, setDeleting] = useState(false);
	const [confirm, setConfirm] = useState("");

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

	return (
		<div class="shortcuts-backdrop">
			<div
				class="shortcuts-dialog account-dialog"
				role="dialog"
				aria-label="Konto"
			>
				<h2>Konto</h2>
				<p>
					<strong>{account.username}</strong>
					{account.email && <span class="muted"> · {account.email}</span>}
				</p>
				<p class="muted">Logowanie: {hasPassword ? "hasło" : "konto Google"}</p>
				{hasPassword && (
					<form
						class="password-form"
						onSubmit={(e) => {
							e.preventDefault();
							changePassword();
						}}
					>
						<h3>Zmiana hasła</h3>
						<input
							type="password"
							name="current"
							placeholder="Obecne hasło"
							autoComplete="current-password"
							value={current}
							onInput={(e) => setCurrent(e.currentTarget.value)}
						/>
						<input
							type="password"
							name="new"
							placeholder="Nowe hasło (min. 8 znaków)"
							autoComplete="new-password"
							value={next}
							onInput={(e) => setNext(e.currentTarget.value)}
						/>
						<button type="submit" disabled={!current || next.length < 8}>
							Zmień hasło
						</button>
					</form>
				)}
				{note && <p class="muted">{note}</p>}
				{error && (
					<p class="shortcut-error" role="alert">
						{error}
					</p>
				)}
				<h3>Usuwanie konta</h3>
				{deleting ? (
					<div class="delete-confirm">
						<p>
							Skasuje to konto, wszystkie Twoje tablice i sesje. To jest
							nieodwracalne. Wpisz nazwę konta ({account.username}), żeby
							potwierdzić.
						</p>
						<input
							name="confirm"
							placeholder={account.username}
							autoComplete="off"
							value={confirm}
							onInput={(e) => setConfirm(e.currentTarget.value)}
						/>
						<button
							type="button"
							class="danger"
							disabled={!matches}
							onClick={remove}
						>
							Usuń na zawsze
						</button>
					</div>
				) : (
					<button
						type="button"
						class="danger"
						onClick={() => setDeleting(true)}
					>
						Usuń konto
					</button>
				)}
				<div class="row">
					<button type="button" class="shortcut-close" onClick={onClose}>
						Zamknij
					</button>
				</div>
			</div>
		</div>
	);
}
