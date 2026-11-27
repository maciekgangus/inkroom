import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { ContactSource, ContactSuggestion } from "./api";
import * as api from "./api";
import { avatarUrl } from "./avatars";
import { DialogShell } from "./board-organize-dialog";
import { Icon } from "./icon";

export const CONTACT_SOURCE_LABEL: Record<ContactSource, string> = {
	contact: "Zapisany znajomy",
	coowner: "Współwłaściciel",
	lesson: "Zajęcia",
	visitor: "Odwiedzał(a) tablicę",
	shared: "Wspólna tablica",
};

function polishBoardsCount(n: number): string {
	if (n === 1) return "1 tablica";
	const mod10 = n % 10;
	const mod100 = n % 100;
	if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
		return `${n} tablice`;
	}
	return `${n} tablic`;
}

function contactSubtitle(c: ContactSuggestion, boardCount: number): string {
	const rel = c.relation
		? CONTACT_SOURCE_LABEL[c.relation]
		: CONTACT_SOURCE_LABEL[c.source];
	if (boardCount > 0) {
		return `${rel} · ${polishBoardsCount(boardCount)}`;
	}
	return rel;
}

/** Personal contacts ("Znajomi") + auto-detected collaborators from boards and lessons (R-123). */
export function ContactsDialog({
	contacts,
	boardCounts,
	onFilterByPerson,
	onContactsChange,
	onClose,
	onNotify,
}: {
	contacts: ContactSuggestion[];
	/** Optional map of lowercase username -> count of boards involving this person in the panel. */
	boardCounts?: Map<string, number>;
	/** Jumps straight to boards involving this person in the panel. */
	onFilterByPerson?: (username: string) => void;
	onContactsChange: (next: ContactSuggestion[]) => void;
	onClose: () => void;
	onNotify: (message: string, undo?: () => void) => void;
}) {
	const [query, setQuery] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const inputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		inputRef.current?.focus();
	}, []);

	const trimmed = query.trim();
	const qLower = trimmed.toLowerCase();

	const savedAll = useMemo(() => contacts.filter((c) => c.saved), [contacts]);
	const recentAll = useMemo(() => contacts.filter((c) => !c.saved), [contacts]);

	const saved = useMemo(
		() =>
			qLower
				? savedAll.filter((c) => c.username.toLowerCase().includes(qLower))
				: savedAll,
		[savedAll, qLower],
	);
	const recent = useMemo(
		() =>
			qLower
				? recentAll.filter((c) => c.username.toLowerCase().includes(qLower))
				: recentAll,
		[recentAll, qLower],
	);

	const savePerson = async (value: string | number) => {
		if (typeof value === "string" && !value.trim()) {
			setError("Podaj login lub adres e-mail.");
			inputRef.current?.focus();
			return;
		}
		if (busy) return;
		setBusy(true);
		setError("");
		try {
			const res = await api.addContact(
				typeof value === "string" ? value.trim() : value,
			);
			onContactsChange(res.contacts);
			if (typeof value === "string") setQuery("");
			onNotify(`Dodano „${res.contact.username}” do znajomych`);
		} catch (e) {
			setError(api.errorMessage(e));
			inputRef.current?.focus();
		} finally {
			setBusy(false);
		}
	};

	const removePerson = async (c: ContactSuggestion) => {
		if (busy) return;
		setBusy(true);
		setError("");
		try {
			const res = await api.removeContact(c.id);
			onContactsChange(res.contacts);
			onNotify(`Usunięto „${c.username}” ze znajomych`, () => {
				void api
					.addContact(c.username) // by id only people still connected qualify
					.then((restored) => onContactsChange(restored.contacts))
					.catch(() => {});
			});
		} catch (e) {
			setError(api.errorMessage(e));
		} finally {
			setBusy(false);
		}
	};

	const boardsOf = (username: string) =>
		boardCounts?.get(username.toLowerCase()) ?? 0;

	return (
		<DialogShell title="Znajomi" onClose={onClose}>
			<div class="org-section">
				<span class="org-label">Szukaj lub dodaj znajomego</span>
				<p class="muted org-hint">
					Zapisane osoby podpowiadają się w „Właściciele…” i „Przekaż…”. Możesz
					też dodać każdego klikając jego nazwę na tablicy lub w panelu.
				</p>
				<form
					class="row org-quick-row"
					onSubmit={(e) => {
						e.preventDefault();
						void savePerson(query);
					}}
				>
					<span class="org-search-input-wrap">
						<Icon name="search" />
						<input
							ref={inputRef}
							name="contactLogin"
							aria-label="Szukaj znajomego lub wpisz login / e-mail"
							autoComplete="off"
							placeholder="Szukaj lub wpisz login / e-mail"
							value={query}
							onInput={(e) => {
								setQuery(e.currentTarget.value);
								if (error) setError("");
							}}
						/>
						{query && (
							<button
								type="button"
								class="org-search-clear"
								aria-label="Wyczyść"
								onClick={() => {
									setQuery("");
									setError("");
									inputRef.current?.focus();
								}}
							>
								<Icon name="close" />
							</button>
						)}
					</span>
					<button type="submit" class="primary" disabled={busy}>
						Dodaj
					</button>
				</form>
				{error && (
					<span class="error" role="alert">
						{error}
					</span>
				)}
			</div>

			<div class="org-section">
				<span class="org-label">
					Twoi znajomi{savedAll.length > 0 ? ` (${savedAll.length})` : ""}
				</span>
				{savedAll.length === 0 ? (
					<div class="org-empty-card">
						<span class="org-empty-icon" aria-hidden="true">
							<Icon name="user-plus" />
						</span>
						<p class="muted org-hint">
							{recentAll.length > 0
								? "Nie masz jeszcze zapisanych znajomych. Zapisz osoby z ostatnich tablic poniżej albo wpisz login u góry."
								: "Nie masz jeszcze zapisanych znajomych. Wpisz login powyżej albo kliknij nazwę dowolnej osoby na tablicy."}
						</p>
					</div>
				) : saved.length === 0 ? (
					<p class="muted org-hint">
						Brak zapisanych znajomych pasujących do „{trimmed}”. Kliknij
						„Dodaj”, aby dodać konto o tym loginie lub e-mailu.
					</p>
				) : (
					<ul class="org-owners-list">
						{saved.map((c) => {
							const count = boardsOf(c.username);
							return (
								<li key={c.id} class="org-owner-row org-contact-row">
									<span class="org-owner-id">
										<span
											class="org-owner-avatar org-contact-avatar"
											aria-hidden="true"
										>
											{avatarUrl(c.avatar) ? (
												<img
													src={avatarUrl(c.avatar) ?? ""}
													alt=""
													width="34"
													height="34"
												/>
											) : (
												c.username.charAt(0)
											)}
										</span>
										<span class="org-owner-meta">
											<span class="org-owner-name">{c.username}</span>
											<span class="muted org-owner-sub">
												{contactSubtitle(c, count)}
											</span>
										</span>
									</span>
									<span class="row org-contact-actions">
										{count > 0 && onFilterByPerson && (
											<button
												type="button"
												class="org-contact-boards-btn"
												title={`Pokaż tablice osoby ${c.username}`}
												onClick={() => {
													onFilterByPerson(c.username);
													onClose();
												}}
											>
												<Icon name="tiles" />
												<span>Tablice</span>
											</button>
										)}
										<button
											type="button"
											class="org-owner-remove"
											disabled={busy}
											aria-label={`Usuń ${c.username} ze znajomych`}
											onClick={() => void removePerson(c)}
										>
											Usuń
										</button>
									</span>
								</li>
							);
						})}
					</ul>
				)}
			</div>

			{recent.length > 0 && (
				<div class="org-section">
					<span class="org-label">
						Z ostatniej współpracy ({recent.length})
					</span>
					<ul class="org-owners-list">
						{recent.map((c) => {
							const count = boardsOf(c.username);
							return (
								<li key={c.id} class="org-owner-row org-contact-row">
									<span class="org-owner-id">
										<span
											class="org-owner-avatar org-contact-avatar"
											aria-hidden="true"
										>
											{avatarUrl(c.avatar) ? (
												<img
													src={avatarUrl(c.avatar) ?? ""}
													alt=""
													width="34"
													height="34"
												/>
											) : (
												c.username.charAt(0)
											)}
										</span>
										<span class="org-owner-meta">
											<span class="org-owner-name">{c.username}</span>
											<span class="muted org-owner-sub">
												{contactSubtitle(c, count)}
											</span>
										</span>
									</span>
									<button
										type="button"
										class="org-owner-save"
										disabled={busy}
										aria-label={`Zapisz ${c.username} do znajomych`}
										onClick={() => void savePerson(c.id)}
									>
										<Icon name="user-plus" />
										<span>Zapisz</span>
									</button>
								</li>
							);
						})}
					</ul>
				</div>
			)}

			<div class="org-dialog-foot">
				<span class="muted org-privacy-inline">
					<Icon name="lock" />
					Widoczni tylko dla Ciebie
				</span>
				<span class="org-spacer" />
				<button type="button" onClick={onClose}>
					Zamknij
				</button>
			</div>
		</DialogShell>
	);
}
