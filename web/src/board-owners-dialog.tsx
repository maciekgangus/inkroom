import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { BoardOwner, BoardSummary, ContactSuggestion } from "./api";
import * as api from "./api";
import { avatarUrl } from "./avatars";
import { DialogShell } from "./board-organize-dialog";
import { CONTACT_SOURCE_LABEL } from "./contacts-dialog";
import { Icon } from "./icon";

function polishBoardsAcc(n: number): string {
	if (n === 1) return "1 tablicę";
	const mod10 = n % 10;
	const mod100 = n % 100;
	if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
		return `${n} tablice`;
	}
	return `${n} tablic`;
}

function MiniAvatar({
	username,
	avatar,
}: {
	username: string;
	avatar?: string;
}) {
	const src = avatarUrl(avatar);
	return (
		<span class="org-suggest-avatar" aria-hidden="true">
			{src ? (
				<img src={src} alt="" width="22" height="22" />
			) : (
				username.charAt(0)
			)}
		</span>
	);
}

/** Manage equal co-owners and transfer sole ownership of one board (R-122, R-123). */
export function BoardOwnersDialog({
	board,
	currentUsername,
	contacts,
	onContactsRefresh,
	onOpenContacts,
	onClose,
	onOwnersChanged,
	onSelfLostOwnership,
}: {
	board: BoardSummary;
	currentUsername: string;
	contacts: ContactSuggestion[];
	onContactsRefresh?: () => void;
	onOpenContacts?: () => void;
	onClose: () => void;
	onOwnersChanged: (owners: string[], message: string) => void;
	onSelfLostOwnership: (newPrimaryOwner: string, message: string) => void;
}) {
	const [owners, setOwners] = useState<BoardOwner[] | null>(null);
	const [loadError, setLoadError] = useState("");
	const [addLogin, setAddLogin] = useState("");
	const [addError, setAddError] = useState("");
	const [transferLogin, setTransferLogin] = useState("");
	const [transferError, setTransferError] = useState("");
	const [confirmTransfer, setConfirmTransfer] = useState(false);
	const [confirmLeaveId, setConfirmLeaveId] = useState<number | null>(null);
	const [busy, setBusy] = useState(false);

	const addInputRef = useRef<HTMLInputElement>(null);
	const transferInputRef = useRef<HTMLInputElement>(null);

	const loadOwners = () => {
		setLoadError("");
		api
			.listBoardOwners(board.id)
			.then((res) => setOwners(res.owners))
			.catch((e) => setLoadError(api.errorMessage(e)));
	};

	useEffect(() => {
		loadOwners();
	}, [board.id]);

	const isMe = (u: string) => u.toLowerCase() === currentUsername.toLowerCase();
	const savedIds = useMemo(
		() => new Set(contacts.filter((c) => c.saved).map((c) => c.id)),
		[contacts],
	);

	const saveOwnerAsFriend = async (owner: BoardOwner) => {
		if (busy) return;
		setBusy(true);
		setAddError("");
		try {
			await api.addContact(owner.id);
			onContactsRefresh?.();
			onOwnersChanged(
				(owners ?? []).map((o) => o.username),
				`Dodano „${owner.username}” do znajomych`,
			);
		} catch (err) {
			setAddError(api.errorMessage(err));
		} finally {
			setBusy(false);
		}
	};

	const addCoOwnerLogin = async (raw: string) => {
		const login = raw.trim();
		if (!login) {
			setAddError("Podaj login lub adres e-mail.");
			addInputRef.current?.focus();
			return;
		}
		if (busy) return;
		setBusy(true);
		setAddError("");
		try {
			const res = await api.addBoardOwner(board.id, login);
			setOwners(res.owners);
			setAddLogin("");
			onContactsRefresh?.();
			onOwnersChanged(
				res.owners.map((o) => o.username),
				`Dodano współwłaściciela „${res.added.username}”`,
			);
		} catch (err) {
			setAddError(api.errorMessage(err));
			addInputRef.current?.focus();
		} finally {
			setBusy(false);
		}
	};

	const removeOwner = async (owner: BoardOwner) => {
		if (busy) return;
		setBusy(true);
		setAddError("");
		try {
			const res = await api.removeBoardOwner(board.id, owner.id);
			setConfirmLeaveId(null);
			if (res.selfRemoved) {
				const nextOwner = res.owners[0]?.username ?? "";
				onSelfLostOwnership(
					nextOwner,
					`Opuszczono współwłasność tablicy „${board.name}”`,
				);
				onClose();
				return;
			}
			setOwners(res.owners);
			onOwnersChanged(
				res.owners.map((o) => o.username),
				`Usunięto „${owner.username}” z właścicieli`,
			);
		} catch (err) {
			setAddError(api.errorMessage(err));
		} finally {
			setBusy(false);
		}
	};

	const startTransferConfirm = (e: Event) => {
		e.preventDefault();
		const login = transferLogin.trim();
		if (!login) {
			setTransferError("Wybierz osobę albo wpisz login / e-mail.");
			transferInputRef.current?.focus();
			return;
		}
		setTransferError("");
		setConfirmTransfer(true);
	};

	const doTransfer = async () => {
		const login = transferLogin.trim();
		if (!login || busy) return;
		setBusy(true);
		setTransferError("");
		try {
			const res = await api.transferBoard(board.id, login);
			onContactsRefresh?.();
			if (isMe(res.owner)) {
				setOwners(res.owners);
				setConfirmTransfer(false);
				setTransferLogin("");
				onOwnersChanged(
					res.owners.map((o) => o.username),
					`Jesteś teraz jedynym właścicielem „${board.name}”`,
				);
				return;
			}
			onSelfLostOwnership(
				res.owner,
				`Przekazano tablicę osobie „${res.owner}”`,
			);
			onClose();
		} catch (err) {
			setTransferError(api.errorMessage(err));
			setConfirmTransfer(false);
			transferInputRef.current?.focus();
		} finally {
			setBusy(false);
		}
	};

	// Live-filtered suggestions for adding a co-owner (excludes people already owning this board).
	const addSuggestions = useMemo(() => {
		const ownerIds = new Set((owners ?? []).map((o) => o.id));
		const ownerNames = new Set(
			(owners ?? []).map((o) => o.username.toLowerCase()),
		);
		const q = addLogin.trim().toLowerCase();
		return contacts
			.filter(
				(c) =>
					!ownerIds.has(c.id) &&
					!ownerNames.has(c.username.toLowerCase()) &&
					(!q || c.username.toLowerCase().includes(q)),
			)
			.slice(0, 6);
	}, [contacts, owners, addLogin]);

	// Live-filtered suggestions for transferring: co-owners of this board first, then other known contacts.
	const transferSuggestions = useMemo(() => {
		const seen = new Set<string>();
		const combined: {
			id: number;
			username: string;
			avatar?: string;
			tag: string;
		}[] = [];
		for (const o of owners ?? []) {
			if (isMe(o.username)) continue;
			const key = o.username.toLowerCase();
			seen.add(key);
			combined.push({
				id: o.id,
				username: o.username,
				avatar: o.avatar,
				tag: "Współwłaściciel",
			});
		}
		for (const c of contacts) {
			const key = c.username.toLowerCase();
			if (seen.has(key) || isMe(c.username)) continue;
			seen.add(key);
			combined.push({
				id: c.id,
				username: c.username,
				avatar: c.avatar,
				tag: CONTACT_SOURCE_LABEL[c.source],
			});
		}
		const q = transferLogin.trim().toLowerCase();
		return combined
			.filter((c) => !q || c.username.toLowerCase().includes(q))
			.slice(0, 6);
	}, [owners, contacts, transferLogin, currentUsername]);

	return (
		<DialogShell
			title={`Właściciele: ${board.name}`}
			onClose={onClose}
			onEscape={() => {
				if (confirmTransfer) {
					setConfirmTransfer(false);
					return true;
				}
				if (confirmLeaveId !== null) {
					setConfirmLeaveId(null);
					return true;
				}
				return false;
			}}
		>
			<div class="org-section">
				<span class="org-label">Współwłaściciele</span>
				<p class="muted org-hint">
					Każdy właściciel ma pełne uprawnienia do tablicy (edycja, tło, prawa
					rysowania, kopiowanie, usuwanie). Możesz dodać znajomego albo kogoś,
					kto był na Twojej tablicy.
				</p>

				{loadError ? (
					<div class="row">
						<span class="error" role="alert">
							{loadError}
						</span>
						<button type="button" onClick={loadOwners}>
							Ponów
						</button>
					</div>
				) : owners === null ? (
					<p class="muted org-hint">Wczytywanie…</p>
				) : (
					<ul class="org-owners-list">
						{owners.map((o) => {
							const self = isMe(o.username);
							const canRemove = owners.length > 1;
							const confirmingSelf = self && confirmLeaveId === o.id;
							return (
								<li key={o.id} class="org-owner-row">
									<span class="org-owner-id">
										<span class="org-owner-avatar" aria-hidden="true">
											{avatarUrl(o.avatar) ? (
												<img
													src={avatarUrl(o.avatar) ?? ""}
													alt=""
													width="28"
													height="28"
												/>
											) : (
												o.username.charAt(0)
											)}
										</span>
										<span class="org-owner-name">{o.username}</span>
										{self && <span class="org-owner-you">Ty</span>}
									</span>
									<span class="row org-owner-row-actions">
										{!self && !savedIds.has(o.id) && (
											<button
												type="button"
												class="org-owner-save"
												disabled={busy}
												title={`Dodaj „${o.username}” do znajomych`}
												aria-label={`Dodaj ${o.username} do znajomych`}
												onClick={() => void saveOwnerAsFriend(o)}
											>
												<Icon name="user-plus" />
												<span>Znajomy</span>
											</button>
										)}
										{canRemove &&
											(confirmingSelf ? (
												<span class="row">
													<button
														type="button"
														disabled={busy}
														onClick={() => setConfirmLeaveId(null)}
													>
														Anuluj
													</button>
													<button
														type="button"
														class="danger"
														disabled={busy}
														onClick={() => void removeOwner(o)}
													>
														Na pewno?
													</button>
												</span>
											) : (
												<button
													type="button"
													class="org-owner-remove"
													disabled={busy}
													aria-label={
														self
															? "Opuść współwłasność"
															: `Usuń właściciela ${o.username}`
													}
													onClick={() => {
														if (self) setConfirmLeaveId(o.id);
														else void removeOwner(o);
													}}
												>
													{self ? "Opuść" : "Usuń"}
												</button>
											))}
									</span>
								</li>
							);
						})}
					</ul>
				)}

				<form
					class="row org-quick-row"
					onSubmit={(e) => {
						e.preventDefault();
						void addCoOwnerLogin(addLogin);
					}}
				>
					<input
						ref={addInputRef}
						name="ownerLogin"
						aria-label="Znajomy, login lub e-mail"
						autoComplete="off"
						placeholder="Znajomy, login lub e-mail"
						value={addLogin}
						onInput={(e) => {
							setAddLogin(e.currentTarget.value);
							if (addError) setAddError("");
						}}
					/>
					<button type="submit" class="primary" disabled={busy}>
						Dodaj
					</button>
				</form>

				{addSuggestions.length > 0 ? (
					<section
						class="org-suggest-wrap"
						aria-label="Podpowiedzi współwłaścicieli"
					>
						<span class="org-suggest-label">Podpowiedzi</span>
						<div class="org-suggest-chips">
							{addSuggestions.map((c) => (
								<button
									key={c.id}
									type="button"
									class="org-suggest-chip"
									disabled={busy}
									title={`Dodaj „${c.username}” (${CONTACT_SOURCE_LABEL[c.relation ?? c.source]})`}
									onClick={() => void addCoOwnerLogin(c.username)}
								>
									<MiniAvatar username={c.username} avatar={c.avatar} />
									<span class="org-suggest-name">{c.username}</span>
									{!c.saved && (
										<span class="org-suggest-tag">
											{CONTACT_SOURCE_LABEL[c.source]}
										</span>
									)}
									<Icon name="plus" />
								</button>
							))}
						</div>
					</section>
				) : (
					onOpenContacts &&
					!addLogin.trim() && (
						<div class="org-suggest-empty">
							<span class="muted org-hint">
								Zapisani znajomi pojawią się tutaj jako szybkie podpowiedzi.
							</span>
							<button
								type="button"
								class="org-inline-link"
								onClick={onOpenContacts}
							>
								Otwórz Znajomych
							</button>
						</div>
					)
				)}

				{addError && (
					<span class="error" role="alert">
						{addError}
					</span>
				)}
			</div>

			<div class="org-section">
				<span class="org-label">Przekaż tablicę</span>
				<p class="muted org-hint">
					Przekazuje pełną własność jednej osobie: znajomemu albo komuś, kto był
					na Twojej tablicy. Tablica przejdzie u Ciebie do „Tablice, do których
					mam dostęp”.
				</p>

				{confirmTransfer ? (
					<div class="org-transfer-confirm">
						<p class="org-hint">
							Przekazać tablicę „{board.name}” osobie „{transferLogin.trim()}”?
							{!isMe(transferLogin.trim()) &&
								" Stracisz uprawnienia właściciela."}
						</p>
						<div class="row org-dialog-foot">
							<button
								type="button"
								disabled={busy}
								onClick={() => setConfirmTransfer(false)}
							>
								Anuluj
							</button>
							<button
								type="button"
								class="danger"
								disabled={busy}
								onClick={() => void doTransfer()}
							>
								{busy ? "Przekazywanie…" : "Na pewno przekazać?"}
							</button>
						</div>
					</div>
				) : (
					<>
						<form class="row org-quick-row" onSubmit={startTransferConfirm}>
							<input
								ref={transferInputRef}
								name="transferLogin"
								aria-label="Odbiorca tablicy (znajomy, login lub e-mail)"
								autoComplete="off"
								placeholder="Znajomy, login lub e-mail"
								value={transferLogin}
								onInput={(e) => {
									setTransferLogin(e.currentTarget.value);
									if (transferError) setTransferError("");
								}}
							/>
							<button type="submit" disabled={busy}>
								Przekaż…
							</button>
						</form>
						{transferSuggestions.length > 0 && (
							<section
								class="org-suggest-wrap"
								aria-label="Podpowiedzi odbiorcy"
							>
								<span class="org-suggest-label">Podpowiedzi</span>
								<div class="org-suggest-chips">
									{transferSuggestions.map((c) => {
										const picked =
											transferLogin.trim().toLowerCase() ===
											c.username.toLowerCase();
										return (
											<button
												key={c.id}
												type="button"
												class="org-suggest-chip"
												aria-pressed={picked}
												title={`${c.username} (${c.tag})`}
												onClick={() => {
													setTransferLogin(c.username);
													setTransferError("");
												}}
											>
												<MiniAvatar username={c.username} avatar={c.avatar} />
												<span class="org-suggest-name">{c.username}</span>
											</button>
										);
									})}
								</div>
							</section>
						)}
					</>
				)}
				{transferError && (
					<span class="error" role="alert">
						{transferError}
					</span>
				)}
			</div>

			<div class="org-dialog-foot org-dialog-foot-end">
				<button type="button" onClick={onClose}>
					Zamknij
				</button>
			</div>
		</DialogShell>
	);
}

/** Bulk transfer of multiple owned boards to another account (R-122, R-123). */
export function BulkTransferDialog({
	boards,
	contacts,
	onContactsRefresh,
	onClose,
	onTransferred,
}: {
	boards: BoardSummary[];
	contacts: ContactSuggestion[];
	onContactsRefresh?: () => void;
	onClose: () => void;
	onTransferred: (boardIds: string[], newOwner: string) => void;
}) {
	const [login, setLogin] = useState("");
	const [confirm, setConfirm] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const inputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		inputRef.current?.focus();
	}, []);

	const preview = boards
		.slice(0, 3)
		.map((b) => b.name)
		.join(", ");
	const rest = boards.length - 3;

	const suggestions = useMemo(() => {
		const q = login.trim().toLowerCase();
		return contacts
			.filter((c) => !q || c.username.toLowerCase().includes(q))
			.slice(0, 6);
	}, [contacts, login]);

	const startConfirm = (e: Event) => {
		e.preventDefault();
		if (!login.trim()) {
			setError("Wybierz osobę albo wpisz login / e-mail.");
			inputRef.current?.focus();
			return;
		}
		setError("");
		setConfirm(true);
	};

	const execute = async () => {
		if (busy) return;
		setBusy(true);
		setError("");
		try {
			const ids = boards.map((b) => b.id);
			const res = await api.bulkTransferBoards(ids, login.trim());
			onContactsRefresh?.();
			onTransferred(ids, res.owner);
			onClose();
		} catch (err) {
			setError(api.errorMessage(err));
			setConfirm(false);
			inputRef.current?.focus();
		} finally {
			setBusy(false);
		}
	};

	return (
		<DialogShell
			title={`Przekaż ${polishBoardsAcc(boards.length)}`}
			onClose={onClose}
			onEscape={() => {
				if (confirm) {
					setConfirm(false);
					return true;
				}
				return false;
			}}
		>
			<div class="org-section">
				<p class="muted org-hint">
					{preview}
					{rest > 0 ? ` (+${rest})` : ""}
				</p>
				<p class="muted org-hint">
					Wybrane tablice trafią do „Moje tablice” odbiorcy (znajomego albo
					kogoś, kto był na Twojej tablicy), a u Ciebie przejdą do „Tablice, do
					których mam dostęp”.
				</p>

				{confirm ? (
					<div class="org-transfer-confirm">
						<p class="org-hint">
							Na pewno przekazać {polishBoardsAcc(boards.length)} osobie „
							{login.trim()}”?
						</p>
						<div class="row org-dialog-foot">
							<button
								type="button"
								disabled={busy}
								onClick={() => setConfirm(false)}
							>
								Anuluj
							</button>
							<button
								type="button"
								class="danger"
								disabled={busy}
								onClick={() => void execute()}
							>
								{busy ? "Przekazywanie…" : "Na pewno przekazać?"}
							</button>
						</div>
					</div>
				) : (
					<form class="stack" onSubmit={startConfirm}>
						<label class="org-field">
							<span class="org-label">Nowy właściciel</span>
							<input
								ref={inputRef}
								name="bulkTransferLogin"
								autoComplete="off"
								placeholder="Znajomy, login lub e-mail"
								value={login}
								onInput={(e) => {
									setLogin(e.currentTarget.value);
									if (error) setError("");
								}}
							/>
						</label>
						{suggestions.length > 0 && (
							<section
								class="org-suggest-wrap"
								aria-label="Podpowiedzi odbiorcy"
							>
								<span class="org-suggest-label">Podpowiedzi</span>
								<div class="org-suggest-chips">
									{suggestions.map((c) => {
										const picked =
											login.trim().toLowerCase() === c.username.toLowerCase();
										return (
											<button
												key={c.id}
												type="button"
												class="org-suggest-chip"
												aria-pressed={picked}
												title={`${c.username} (${CONTACT_SOURCE_LABEL[c.source]})`}
												onClick={() => {
													setLogin(c.username);
													setError("");
												}}
											>
												<MiniAvatar username={c.username} avatar={c.avatar} />
												<span class="org-suggest-name">{c.username}</span>
											</button>
										);
									})}
								</div>
							</section>
						)}
						{error && (
							<span class="error" role="alert">
								{error}
							</span>
						)}
						<div class="org-dialog-foot org-dialog-foot-end">
							<button type="button" onClick={onClose} disabled={busy}>
								Anuluj
							</button>
							<button type="submit" class="primary" disabled={busy}>
								Przekaż…
							</button>
						</div>
					</form>
				)}
			</div>
		</DialogShell>
	);
}
