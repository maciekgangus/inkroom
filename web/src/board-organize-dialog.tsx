import type { ComponentChildren } from "preact";
import { useEffect, useId, useRef, useState } from "preact/hooks";
import type { BoardFolder, BoardMarker, BoardSummary, OrgColor } from "./api";
import * as api from "./api";
import { ORG_COLORS } from "./board-organize";
import { Icon } from "./icon";

const FOCUSABLE =
	'button:not(:disabled), input:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])';

/** Small circular ink dot used for folders and labels without breaking The Quiet Desk. */
export function ColorDot({ color }: { color?: OrgColor }) {
	if (!color) return null;
	return <span class={`org-dot org-color-${color}`} aria-hidden="true" />;
}

function ColorPicker({
	label = "Kolor",
	value,
	onChange,
}: {
	label?: string;
	value: OrgColor;
	onChange: (c: OrgColor) => void;
}) {
	return (
		<fieldset class="org-color-row" aria-label={label}>
			{ORG_COLORS.map((c) => (
				<button
					key={c.id || "none"}
					type="button"
					class={`org-color-btn${c.id ? ` org-color-${c.id}` : " org-color-none"}`}
					aria-label={c.label}
					title={c.label}
					aria-pressed={value === c.id}
					onClick={() => onChange(c.id)}
				>
					{c.id === "" ? (
						<span class="org-color-slash" aria-hidden="true" />
					) : null}
				</button>
			))}
		</fieldset>
	);
}

/** Accessible modal shell matching AccountDialog (focus trap, Escape, 420px, 17px heading). */
export function DialogShell({
	title,
	onClose,
	onEscape,
	children,
}: {
	title: string;
	onClose: () => void;
	/** Optional Escape override (return true if handled internally, e.g. cancel inline edit). */
	onEscape?: () => boolean;
	children: ComponentChildren;
}) {
	const ref = useRef<HTMLDivElement>(null);
	const titleId = useId();

	useEffect(() => {
		const before = document.activeElement as HTMLElement | null;
		ref.current?.focus();
		return () => before?.focus?.();
	}, []);

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			if (onEscape?.()) return;
			onClose();
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [onClose, onEscape]);

	const trapTab = (e: KeyboardEvent) => {
		if (e.key !== "Tab" || !ref.current) return;
		const items = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
		if (items.length === 0) return;
		const first = items[0];
		const last = items[items.length - 1];
		const active = document.activeElement;
		if (e.shiftKey && (active === first || active === ref.current)) {
			e.preventDefault();
			last.focus();
		} else if (!e.shiftKey && active === last) {
			e.preventDefault();
			first.focus();
		}
	};

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: backdrop click closes; Escape and the close button are keyboard ways.
		<div
			class="shortcuts-backdrop"
			role="presentation"
			onMouseDown={(e) => {
				if (e.target === e.currentTarget) onClose();
			}}
		>
			<div
				ref={ref}
				class="shortcuts-dialog org-dialog"
				role="dialog"
				aria-modal="true"
				aria-labelledby={titleId}
				tabIndex={-1}
				onKeyDown={trapTab}
			>
				<div class="org-dialog-head">
					<h2 id={titleId} class="org-dialog-title">
						{title}
					</h2>
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
				{children}
			</div>
		</div>
	);
}

/** Dialog for creating or editing a folder (R-121). */
export function FolderDialog({
	folder,
	startConfirmDelete = false,
	onClose,
	onSaved,
	onDeleted,
}: {
	folder: BoardFolder | null;
	startConfirmDelete?: boolean;
	onClose: () => void;
	onSaved: (f: BoardFolder) => void;
	onDeleted?: (id: string) => void;
}) {
	const [name, setName] = useState(folder?.name ?? "");
	const [color, setColor] = useState<OrgColor>(folder?.color ?? "indigo");
	const [confirmDelete, setConfirmDelete] = useState(
		Boolean(folder && startConfirmDelete),
	);
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		if (!startConfirmDelete) inputRef.current?.focus();
	}, [startConfirmDelete]);

	const submit = async () => {
		const trimmed = name.trim();
		if (!trimmed) {
			setError("Podaj nazwę folderu.");
			inputRef.current?.focus();
			return;
		}
		if (busy) return;
		setBusy(true);
		setError("");
		try {
			const saved = folder
				? await api.updateFolder(folder.id, { name: trimmed, color })
				: await api.createFolder(trimmed, color);
			onSaved(saved);
			onClose();
		} catch (e) {
			setError(api.errorMessage(e));
		} finally {
			setBusy(false);
		}
	};

	const remove = async () => {
		if (!folder || busy) return;
		setBusy(true);
		setError("");
		try {
			await api.deleteFolder(folder.id);
			onDeleted?.(folder.id);
			onClose();
		} catch (e) {
			setError(api.errorMessage(e));
		} finally {
			setBusy(false);
		}
	};

	return (
		<DialogShell
			title={folder ? "Edytuj folder" : "Nowy folder"}
			onClose={onClose}
		>
			<form
				class="org-dialog-body"
				onSubmit={(e) => {
					e.preventDefault();
					void submit();
				}}
			>
				<div class="org-section">
					<div class="org-field">
						<label class="org-label" htmlFor="folder-name-input">
							Nazwa folderu
						</label>
						<input
							ref={inputRef}
							id="folder-name-input"
							name="folderName"
							autoComplete="off"
							placeholder="np. Matematyka klasa 8…"
							maxLength={48}
							value={name}
							onInput={(e) => {
								setName(e.currentTarget.value);
								if (error) setError("");
							}}
						/>
						{error && (
							<p class="error" role="alert">
								{error}
							</p>
						)}
					</div>
					<div class="org-field">
						<span class="org-label">Kolor kropki</span>
						<ColorPicker
							label="Kolor folderu"
							value={color}
							onChange={setColor}
						/>
					</div>
				</div>

				{confirmDelete && folder && (
					<div class="org-section org-confirm-box">
						<p class="muted org-hint">
							Usunąć folder „{folder.name}”? Tablice w środku nie znikną —
							zostaną w „Bez folderu”.
						</p>
						<div class="row">
							<button
								type="button"
								onClick={() => setConfirmDelete(false)}
								disabled={busy}
							>
								Anuluj
							</button>
							<button
								type="button"
								class="danger"
								disabled={busy}
								onClick={remove}
							>
								{busy ? "Usuwanie…" : "Usuń folder"}
							</button>
						</div>
					</div>
				)}

				<div class="org-dialog-foot">
					{folder && !confirmDelete && (
						<button
							type="button"
							class="danger-outline"
							disabled={busy}
							onClick={() => setConfirmDelete(true)}
						>
							Usuń
						</button>
					)}
					<span class="org-spacer" />
					<button type="button" onClick={onClose}>
						Anuluj
					</button>
					<button type="submit" class="primary" disabled={busy}>
						{busy ? "Zapisywanie…" : folder ? "Zapisz" : "Utwórz folder"}
					</button>
				</div>
			</form>
		</DialogShell>
	);
}

function boardsCountText(n: number): string {
	if (n === 0) return "0 tablic";
	if (n === 1) return "1 tablica";
	const mod10 = n % 10;
	const mod100 = n % 100;
	if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
		return `${n} tablice`;
	}
	return `${n} tablic`;
}

/** Dialog for creating, renaming, recoloring, and safely deleting labels (R-121). */
export function MarkersDialog({
	markers,
	usageCounts,
	onClose,
	onCreated,
	onUpdated,
	onDeleted,
}: {
	markers: BoardMarker[];
	usageCounts?: Map<string, number>;
	onClose: () => void;
	onCreated: (m: BoardMarker) => void;
	onUpdated: (m: BoardMarker) => void;
	onDeleted: (id: string) => void;
}) {
	const [name, setName] = useState("");
	const [color, setColor] = useState<OrgColor>("rose");
	const [editingId, setEditingId] = useState<string | null>(null);
	const [editName, setEditName] = useState("");
	const [editColor, setEditColor] = useState<OrgColor>("");
	const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);
	const addInputRef = useRef<HTMLInputElement>(null);
	const editInputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		if (editingId) editInputRef.current?.focus();
	}, [editingId]);

	const add = async () => {
		const trimmed = name.trim();
		if (!trimmed) {
			setError("Podaj nazwę etykiety.");
			addInputRef.current?.focus();
			return;
		}
		if (busy) return;
		setBusy(true);
		setError("");
		try {
			const created = await api.createMarker(trimmed, color);
			onCreated(created);
			setName("");
		} catch (e) {
			setError(api.errorMessage(e));
		} finally {
			setBusy(false);
		}
	};

	const saveEdit = async (id: string) => {
		const trimmed = editName.trim();
		if (!trimmed) {
			setError("Podaj nazwę etykiety.");
			editInputRef.current?.focus();
			return;
		}
		if (busy) return;
		setBusy(true);
		setError("");
		try {
			const updated = await api.updateMarker(id, {
				name: trimmed,
				color: editColor,
			});
			onUpdated(updated);
			setEditingId(null);
		} catch (e) {
			setError(api.errorMessage(e));
		} finally {
			setBusy(false);
		}
	};

	const remove = async (id: string) => {
		if (busy) return;
		setBusy(true);
		setError("");
		try {
			await api.deleteMarker(id);
			onDeleted(id);
			setConfirmDeleteId(null);
		} catch (e) {
			setError(api.errorMessage(e));
		} finally {
			setBusy(false);
		}
	};

	return (
		<DialogShell
			title="Etykiety"
			onClose={onClose}
			onEscape={() => {
				if (editingId) {
					setEditingId(null);
					return true;
				}
				if (confirmDeleteId) {
					setConfirmDeleteId(null);
					return true;
				}
				return false;
			}}
		>
			<div class="org-dialog-body">
				<form
					class="org-section"
					onSubmit={(e) => {
						e.preventDefault();
						void add();
					}}
				>
					<div class="org-field">
						<label class="org-label" htmlFor="new-marker-input">
							Nowa etykieta
						</label>
						<div class="row org-inline-add">
							<input
								ref={addInputRef}
								id="new-marker-input"
								name="markerName"
								autoComplete="off"
								placeholder="np. Matura, Pilne…"
								maxLength={48}
								value={name}
								onInput={(e) => {
									setName(e.currentTarget.value);
									if (error) setError("");
								}}
							/>
							<button type="submit" class="primary" disabled={busy}>
								{busy ? "…" : "Dodaj"}
							</button>
						</div>
					</div>
					<div class="org-field">
						<span class="org-label">Kolor nowej etykiety</span>
						<ColorPicker
							label="Kolor nowej etykiety"
							value={color}
							onChange={setColor}
						/>
					</div>
					{error && (
						<p class="error" role="alert">
							{error}
						</p>
					)}
				</form>

				<div class="org-section">
					<span class="org-label">Twoje etykiety ({markers.length})</span>
					{markers.length === 0 ? (
						<p class="muted org-hint">
							Nie masz jeszcze etykiet. Dodaj pierwszą powyżej, żeby oznaczać
							tablice.
						</p>
					) : (
						<ul class="org-marker-list">
							{markers.map((m) => {
								const count = usageCounts?.get(m.id) ?? 0;
								return (
									<li key={m.id} class="org-marker-item">
										{editingId === m.id ? (
											<div class="stack" style="width: 100%">
												<div class="row org-inline-add">
													<input
														ref={editInputRef}
														name="editMarkerName"
														aria-label={`Edytuj nazwę etykiety ${m.name}`}
														autoComplete="off"
														value={editName}
														maxLength={48}
														onInput={(e) => setEditName(e.currentTarget.value)}
														onKeyDown={(e) => {
															if (e.key === "Enter") {
																e.preventDefault();
																void saveEdit(m.id);
															}
														}}
													/>
													<button
														type="button"
														onClick={() => setEditingId(null)}
													>
														Anuluj
													</button>
													<button
														type="button"
														class="primary"
														disabled={busy}
														onClick={() => void saveEdit(m.id)}
													>
														Zapisz
													</button>
												</div>
												<ColorPicker
													label={`Kolor etykiety ${m.name}`}
													value={editColor}
													onChange={setEditColor}
												/>
											</div>
										) : confirmDeleteId === m.id ? (
											<div class="org-marker-confirm">
												<span class="org-hint muted">
													Usunąć „{m.name}”?{" "}
													{count > 0
														? `Zdejmie etykietę z ${boardsCountText(count)}.`
														: ""}
												</span>
												<div class="row">
													<button
														type="button"
														onClick={() => setConfirmDeleteId(null)}
														disabled={busy}
													>
														Anuluj
													</button>
													<button
														type="button"
														class="danger"
														disabled={busy}
														onClick={() => void remove(m.id)}
													>
														Usuń
													</button>
												</div>
											</div>
										) : (
											<>
												<span class="org-marker-label">
													<ColorDot color={m.color} />
													<span class="org-marker-name">{m.name}</span>
													<span class="org-count">{count}</span>
												</span>
												<span class="row">
													<button
														type="button"
														class="icon-btn"
														aria-label={`Edytuj etykietę ${m.name}`}
														title="Edytuj"
														onClick={() => {
															setConfirmDeleteId(null);
															setEditingId(m.id);
															setEditName(m.name);
															setEditColor(m.color ?? "");
														}}
													>
														<Icon name="pen" />
													</button>
													<button
														type="button"
														class="icon-btn"
														aria-label={`Usuń etykietę ${m.name}`}
														title="Usuń"
														disabled={busy}
														onClick={() => {
															setEditingId(null);
															setConfirmDeleteId(m.id);
														}}
													>
														<Icon name="trash" />
													</button>
												</span>
											</>
										)}
									</li>
								);
							})}
						</ul>
					)}
				</div>

				<p class="muted org-privacy-note">
					<Icon name="lock" /> Etykiety widzisz tylko Ty na swojej liście
					tablic.
				</p>
			</div>
		</DialogShell>
	);
}

/**
 * Dialog for organizing one board or a bulk selection: assign folder, toggle pin,
 * pick/create labels with progressive disclosure and true 3-state bulk toggling (R-121).
 */
export function BoardOrganizeDialog({
	boards,
	folders,
	markers,
	onClose,
	onFolderCreated,
	onMarkerCreated,
	onApplied,
}: {
	boards: BoardSummary[];
	folders: BoardFolder[];
	markers: BoardMarker[];
	onClose: () => void;
	onFolderCreated: (f: BoardFolder) => void;
	onMarkerCreated: (m: BoardMarker) => void;
	onApplied: (patch: {
		boardIds: string[];
		folderId?: string;
		pinned?: boolean;
		markerIds?: string[];
		addMarkerIds?: string[];
		removeMarkerIds?: string[];
	}) => void;
}) {
	const single = boards.length === 1 ? boards[0] : null;
	const [folderId, setFolderId] = useState<string | undefined>(
		single ? (single.folderId ?? "") : undefined,
	);
	const [pinned, setPinned] = useState<boolean | undefined>(
		single ? Boolean(single.pinned) : undefined,
	);
	// Single mode uses `selectedMarkers`; bulk mode uses 3-state map: undefined -> "add" -> "remove" -> undefined.
	const [selectedMarkers, setSelectedMarkers] = useState<Set<string>>(
		() => new Set(single?.markerIds ?? []),
	);
	const [bulkMarkerState, setBulkMarkerState] = useState<
		Map<string, "add" | "remove">
	>(() => new Map());

	const [addingFolder, setAddingFolder] = useState(false);
	const [newFolderName, setNewFolderName] = useState("");
	const [newFolderColor, setNewFolderColor] = useState<OrgColor>("indigo");

	const [addingMarker, setAddingMarker] = useState(false);
	const [newMarkerName, setNewMarkerName] = useState("");
	const [newMarkerColor, setNewMarkerColor] = useState<OrgColor>("rose");

	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);
	const quickFolderRef = useRef<HTMLInputElement>(null);
	const quickMarkerRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		if (addingFolder) quickFolderRef.current?.focus();
	}, [addingFolder]);
	useEffect(() => {
		if (addingMarker) quickMarkerRef.current?.focus();
	}, [addingMarker]);

	const toggleMarker = (id: string) => {
		if (single) {
			const next = new Set(selectedMarkers);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			setSelectedMarkers(next);
			return;
		}
		const next = new Map(bulkMarkerState);
		const cur = next.get(id);
		if (!cur) next.set(id, "add");
		else if (cur === "add") next.set(id, "remove");
		else next.delete(id);
		setBulkMarkerState(next);
	};

	const quickCreateFolder = async () => {
		const trimmed = newFolderName.trim();
		if (!trimmed || busy) return;
		setBusy(true);
		setError("");
		try {
			const created = await api.createFolder(trimmed, newFolderColor);
			onFolderCreated(created);
			setFolderId(created.id);
			setNewFolderName("");
			setAddingFolder(false);
		} catch (e) {
			setError(api.errorMessage(e));
		} finally {
			setBusy(false);
		}
	};

	const quickCreateMarker = async () => {
		const trimmed = newMarkerName.trim();
		if (!trimmed || busy) return;
		setBusy(true);
		setError("");
		try {
			const created = await api.createMarker(trimmed, newMarkerColor);
			onMarkerCreated(created);
			if (single) {
				const next = new Set(selectedMarkers);
				next.add(created.id);
				setSelectedMarkers(next);
			} else {
				const next = new Map(bulkMarkerState);
				next.set(created.id, "add");
				setBulkMarkerState(next);
			}
			setNewMarkerName("");
			setAddingMarker(false);
		} catch (e) {
			setError(api.errorMessage(e));
		} finally {
			setBusy(false);
		}
	};

	const save = async () => {
		if (busy) return;
		setBusy(true);
		setError("");
		const ids = boards.map((b) => b.id);
		try {
			if (single) {
				const markerIds = [...selectedMarkers];
				await api.updateBoardMeta(single.id, {
					folderId: folderId ?? "",
					pinned: Boolean(pinned),
					markerIds,
				});
				onApplied({
					boardIds: ids,
					folderId: folderId ?? "",
					pinned: Boolean(pinned),
					markerIds,
				});
			} else {
				const addMarkerIds: string[] = [];
				const removeMarkerIds: string[] = [];
				for (const [id, st] of bulkMarkerState) {
					if (st === "add") addMarkerIds.push(id);
					else removeMarkerIds.push(id);
				}
				await api.bulkOrganizeBoards({
					boardIds: ids,
					folderId,
					pinned,
					addMarkerIds,
					removeMarkerIds,
				});
				onApplied({
					boardIds: ids,
					folderId,
					pinned,
					addMarkerIds,
					removeMarkerIds,
				});
			}
			onClose();
		} catch (e) {
			setError(api.errorMessage(e));
		} finally {
			setBusy(false);
		}
	};

	const title = single
		? `Organizuj: ${single.name}`
		: `Organizuj zaznaczone (${boards.length})`;

	return (
		<DialogShell title={title} onClose={onClose}>
			<div class="org-dialog-body">
				<div class="org-section">
					<fieldset class="org-field-group" aria-label="Folder">
						<span class="org-label" aria-hidden="true">
							Folder
						</span>
						<div class="org-pill-group">
							{!single && (
								<button
									type="button"
									class="org-pill"
									aria-pressed={folderId === undefined}
									onClick={() => setFolderId(undefined)}
								>
									Bez zmian
								</button>
							)}
							<button
								type="button"
								class="org-pill"
								aria-pressed={folderId === ""}
								onClick={() => setFolderId("")}
							>
								Bez folderu
							</button>
							{folders.map((f) => (
								<button
									key={f.id}
									type="button"
									class="org-pill"
									aria-pressed={folderId === f.id}
									onClick={() => setFolderId(f.id)}
								>
									<ColorDot color={f.color} />
									{f.name}
								</button>
							))}
							<button
								type="button"
								class="org-pill org-pill-add"
								aria-expanded={addingFolder}
								onClick={() => setAddingFolder(!addingFolder)}
							>
								<Icon name="plus" />
								Nowy folder
							</button>
						</div>
					</fieldset>
					{addingFolder && (
						<div class="org-inline-creator">
							<div class="row org-inline-add">
								<input
									ref={quickFolderRef}
									name="quickFolder"
									aria-label="Nazwa nowego folderu"
									autoComplete="off"
									placeholder="Nazwa nowego folderu…"
									maxLength={48}
									value={newFolderName}
									onInput={(e) => setNewFolderName(e.currentTarget.value)}
									onKeyDown={(e) => {
										if (e.key === "Enter") {
											e.preventDefault();
											void quickCreateFolder();
										}
									}}
								/>
								<button
									type="button"
									disabled={busy || newFolderName.trim() === ""}
									onClick={() => void quickCreateFolder()}
								>
									Dodaj
								</button>
							</div>
							<ColorPicker
								label="Kolor nowego folderu"
								value={newFolderColor}
								onChange={setNewFolderColor}
							/>
						</div>
					)}
				</div>

				<div class="org-section">
					<fieldset class="org-field-group" aria-label="Etykiety">
						<span class="org-label" aria-hidden="true">
							{single
								? "Etykiety"
								: "Etykiety (kliknij: dodaj → zdejmij → bez zmian)"}
						</span>
						<div class="org-pill-group">
							{markers.map((m) => {
								const state = single
									? selectedMarkers.has(m.id)
										? "add"
										: undefined
									: bulkMarkerState.get(m.id);
								return (
									<button
										key={m.id}
										type="button"
										class={`org-pill${state === "remove" ? " org-pill-remove" : ""}`}
										aria-pressed={state === "add"}
										onClick={() => toggleMarker(m.id)}
									>
										<ColorDot color={m.color} />
										{m.name}
										{!single && state === "add" ? " (+)" : ""}
										{!single && state === "remove" ? " (usuń)" : ""}
									</button>
								);
							})}
							<button
								type="button"
								class="org-pill org-pill-add"
								aria-expanded={addingMarker}
								onClick={() => setAddingMarker(!addingMarker)}
							>
								<Icon name="plus" />
								Nowa etykieta
							</button>
						</div>
					</fieldset>
					{addingMarker && (
						<div class="org-inline-creator">
							<div class="row org-inline-add">
								<input
									ref={quickMarkerRef}
									name="quickMarker"
									aria-label="Nazwa nowej etykiety"
									autoComplete="off"
									placeholder="Nowa etykieta (np. Powtórka)…"
									maxLength={48}
									value={newMarkerName}
									onInput={(e) => setNewMarkerName(e.currentTarget.value)}
									onKeyDown={(e) => {
										if (e.key === "Enter") {
											e.preventDefault();
											void quickCreateMarker();
										}
									}}
								/>
								<button
									type="button"
									disabled={busy || newMarkerName.trim() === ""}
									onClick={() => void quickCreateMarker()}
								>
									Dodaj
								</button>
							</div>
							<ColorPicker
								label="Kolor nowej etykiety"
								value={newMarkerColor}
								onChange={setNewMarkerColor}
							/>
						</div>
					)}
				</div>

				<div class="org-section">
					<fieldset class="org-field-group" aria-label="Przypięcie">
						<span class="org-label" aria-hidden="true">
							Przypięcie
						</span>
						<div class="org-pill-group">
							{!single && (
								<button
									type="button"
									class="org-pill"
									aria-pressed={pinned === undefined}
									onClick={() => setPinned(undefined)}
								>
									Bez zmian
								</button>
							)}
							<button
								type="button"
								class="org-pill"
								aria-pressed={pinned === true}
								onClick={() => setPinned(single ? !pinned : true)}
							>
								<Icon name="pin" />
								{single
									? pinned
										? "Przypięta na górze"
										: "Przypnij na górze"
									: "Przypnij"}
							</button>
							{!single && (
								<button
									type="button"
									class="org-pill"
									aria-pressed={pinned === false}
									onClick={() => setPinned(false)}
								>
									Odepnij
								</button>
							)}
						</div>
					</fieldset>
				</div>

				{error && (
					<p class="error" role="alert">
						{error}
					</p>
				)}

				<div class="org-dialog-foot">
					<span class="muted org-privacy-inline">
						Widoczne tylko dla Ciebie
					</span>
					<span class="org-spacer" />
					<button type="button" onClick={onClose}>
						Anuluj
					</button>
					<button
						type="button"
						class="primary"
						disabled={busy}
						onClick={() => void save()}
					>
						{busy ? "Zapisywanie…" : "Zapisz"}
					</button>
				</div>
			</div>
		</DialogShell>
	);
}
