import { useEffect, useState } from "preact/hooks";
import type { BoardFolder, BoardMarker } from "./api";
import type { BoardFilter } from "./board-filter";
import { ColorDot } from "./board-organize-dialog";
import { Icon } from "./icon";

export interface SidebarProps {
	filter: BoardFilter;
	folders: BoardFolder[];
	markers: BoardMarker[];
	counts: {
		total: number;
		owned: number;
		visited: number;
		pinned: number;
		unfiled: number;
		byFolder: Map<string, number>;
		byMarker: Map<string, number>;
	};
	dragBoardId: string | null;
	dropFolderId: string | null;
	onDropFolderChange: (id: string | null) => void;
	onDropBoard: (boardId: string, folderId: string) => void;
	onPatch: (p: Partial<BoardFilter>) => void;
	onToggleMarker: (id: string) => void;
	onNewFolder: () => void;
	onEditFolder: (f: BoardFolder, confirmDelete?: boolean) => void;
	onReorderFolder: (id: string, delta: -1 | 1) => void;
	onCreateInFolder: (folderId: string) => void;
	onManageMarkers: () => void;
	contactsCount: number;
	contactSuggestionsCount?: number;
	onManageContacts: () => void;
	onPickClose?: () => void;
}

/** Quiet left workspace navigation: Views, Folders (with reorder/edit menu + drop targets) & Labels. */
export function PanelSidebar({
	filter,
	folders,
	markers,
	counts,
	dragBoardId,
	dropFolderId,
	onDropFolderChange,
	onDropBoard,
	onPatch,
	onToggleMarker,
	onNewFolder,
	onEditFolder,
	onReorderFolder,
	onCreateInFolder,
	onManageMarkers,
	contactsCount,
	contactSuggestionsCount = 0,
	onManageContacts,
	onPickClose,
}: SidebarProps) {
	const [openMenuId, setOpenMenuId] = useState<string | null>(null);

	useEffect(() => {
		if (!openMenuId) return;
		const onDown = (e: MouseEvent) => {
			const el = e.target as HTMLElement | null;
			if (!el?.closest(".sidebar-menu-wrap")) setOpenMenuId(null);
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") setOpenMenuId(null);
		};
		document.addEventListener("mousedown", onDown);
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("mousedown", onDown);
			document.removeEventListener("keydown", onKey);
		};
	}, [openMenuId]);

	const pick = (p: Partial<BoardFilter>) => {
		onPatch(p);
		onPickClose?.();
	};

	const activeFolder = filter.folder ?? "all";
	const isAll =
		activeFolder === "all" && !filter.pinnedOnly && filter.scope === "all";

	return (
		<nav class="sidebar-nav" aria-label="Nawigacja tablic">
			<div class="sidebar-group">
				<span class="sidebar-heading">Widoki</span>
				<button
					type="button"
					class="sidebar-item"
					aria-current={isAll ? "page" : undefined}
					aria-pressed={isAll}
					onClick={() =>
						pick({ folder: "all", pinnedOnly: false, scope: "all" })
					}
				>
					<Icon name="tiles" />
					<span class="sidebar-item-label">Wszystko</span>
					<span class="org-count">{counts.total}</span>
				</button>
				{counts.pinned > 0 && (
					<button
						type="button"
						class="sidebar-item"
						aria-pressed={Boolean(filter.pinnedOnly)}
						onClick={() =>
							pick({
								pinnedOnly: !filter.pinnedOnly,
								folder: "all",
								scope: "all",
							})
						}
					>
						<Icon name="pin" />
						<span class="sidebar-item-label">Przypięte</span>
						<span class="org-count">{counts.pinned}</span>
					</button>
				)}
				<button
					type="button"
					class="sidebar-item"
					aria-pressed={
						filter.scope === "mine" &&
						activeFolder === "all" &&
						!filter.pinnedOnly
					}
					onClick={() =>
						pick({ scope: "mine", folder: "all", pinnedOnly: false })
					}
				>
					<Icon name="file" />
					<span class="sidebar-item-label">Moje</span>
					<span class="org-count">{counts.owned}</span>
				</button>
				{counts.visited > 0 && (
					<button
						type="button"
						class="sidebar-item"
						aria-pressed={
							filter.scope === "shared" &&
							activeFolder === "all" &&
							!filter.pinnedOnly
						}
						onClick={() =>
							pick({ scope: "shared", folder: "all", pinnedOnly: false })
						}
					>
						<Icon name="share" />
						<span class="sidebar-item-label">Udostępnione</span>
						<span class="org-count">{counts.visited}</span>
					</button>
				)}
			</div>

			<div class="sidebar-group">
				<div class="sidebar-group-head">
					<span class="sidebar-heading">Foldery</span>
					<button
						type="button"
						class="sidebar-add-btn"
						aria-label="Nowy folder"
						title="Nowy folder"
						onClick={onNewFolder}
					>
						<Icon name="plus" />
					</button>
				</div>
				{folders.length === 0 ? (
					<button type="button" class="sidebar-empty-btn" onClick={onNewFolder}>
						<Icon name="plus" />
						Utwórz pierwszy folder
					</button>
				) : (
					<>
						{folders.map((f, idx) => {
							const active = activeFolder === f.id && !filter.pinnedOnly;
							const dropping = dropFolderId === f.id;
							const menuOpen = openMenuId === f.id;
							return (
								<div
									key={f.id}
									class={`sidebar-item-row${dropping ? " org-drop-target" : ""}`}
								>
									<button
										type="button"
										class="sidebar-item"
										aria-pressed={active}
										onDragOver={(e) => {
											if (!dragBoardId) return;
											e.preventDefault();
											onDropFolderChange(f.id);
										}}
										onDragLeave={() => {
											if (dropFolderId === f.id) onDropFolderChange(null);
										}}
										onDrop={(e) => {
											e.preventDefault();
											const id =
												e.dataTransfer?.getData("text/plain") || dragBoardId;
											onDropFolderChange(null);
											if (id) onDropBoard(id, f.id);
										}}
										onClick={() =>
											pick({
												folder: active ? "all" : f.id,
												pinnedOnly: false,
												scope: "all",
											})
										}
									>
										{f.color ? (
											<ColorDot color={f.color} />
										) : (
											<Icon name="folder" />
										)}
										<span class="sidebar-item-label" title={f.name}>
											{f.name}
										</span>
										<span class="org-count">
											{counts.byFolder.get(f.id) ?? 0}
										</span>
									</button>
									<div class="sidebar-menu-wrap">
										<button
											type="button"
											class="sidebar-more-btn"
											aria-label={`Opcje folderu ${f.name}`}
											title={`Opcje folderu ${f.name}`}
											aria-expanded={menuOpen}
											onClick={(e) => {
												e.stopPropagation();
												setOpenMenuId(menuOpen ? null : f.id);
											}}
										>
											<Icon name="more" />
										</button>
										{menuOpen && (
											<div
												class="action-popover sidebar-popover"
												role="menu"
												aria-label={`Opcje folderu ${f.name}`}
											>
												<button
													type="button"
													role="menuitem"
													onClick={() => {
														setOpenMenuId(null);
														onEditFolder(f, false);
													}}
												>
													<Icon name="pen" />
													Edytuj folder
												</button>
												<button
													type="button"
													role="menuitem"
													onClick={() => {
														setOpenMenuId(null);
														onCreateInFolder(f.id);
														onPickClose?.();
													}}
												>
													<Icon name="plus" />
													Nowa tablica tutaj
												</button>
												{idx > 0 && (
													<button
														type="button"
														role="menuitem"
														onClick={() => {
															setOpenMenuId(null);
															onReorderFolder(f.id, -1);
														}}
													>
														<Icon name="arrow-up" />
														Przesuń wyżej
													</button>
												)}
												{idx < folders.length - 1 && (
													<button
														type="button"
														role="menuitem"
														onClick={() => {
															setOpenMenuId(null);
															onReorderFolder(f.id, 1);
														}}
													>
														<Icon name="arrow-down" />
														Przesuń niżej
													</button>
												)}
												<hr class="popover-sep" />
												<button
													type="button"
													role="menuitem"
													class="popover-danger"
													onClick={() => {
														setOpenMenuId(null);
														onEditFolder(f, true);
													}}
												>
													<Icon name="trash" />
													Usuń folder
												</button>
											</div>
										)}
									</div>
								</div>
							);
						})}
						<button
							type="button"
							class={`sidebar-item${dropFolderId === "unfiled" ? " org-drop-target" : ""}`}
							aria-pressed={activeFolder === "unfiled" && !filter.pinnedOnly}
							onClick={() =>
								pick({
									folder: activeFolder === "unfiled" ? "all" : "unfiled",
									pinnedOnly: false,
									scope: "all",
								})
							}
							onDragOver={(e) => {
								if (!dragBoardId) return;
								e.preventDefault();
								onDropFolderChange("unfiled");
							}}
							onDragLeave={() => {
								if (dropFolderId === "unfiled") onDropFolderChange(null);
							}}
							onDrop={(e) => {
								e.preventDefault();
								const id = e.dataTransfer?.getData("text/plain") || dragBoardId;
								onDropFolderChange(null);
								if (id) onDropBoard(id, "");
							}}
						>
							<Icon name="plain" />
							<span class="sidebar-item-label">Bez folderu</span>
							<span class="org-count">{counts.unfiled}</span>
						</button>
					</>
				)}
			</div>

			<div class="sidebar-group">
				<div class="sidebar-group-head">
					<span class="sidebar-heading">Etykiety</span>
					<button
						type="button"
						class="sidebar-add-btn"
						aria-label="Zarządzaj etykietami"
						title="Zarządzaj etykietami"
						onClick={onManageMarkers}
					>
						<Icon name="plus" />
					</button>
				</div>
				{markers.length === 0 ? (
					<button
						type="button"
						class="sidebar-empty-btn"
						onClick={onManageMarkers}
					>
						<Icon name="tag" />
						Dodaj etykietę
					</button>
				) : (
					markers.map((m) => {
						const active = (filter.markerIds ?? []).includes(m.id);
						return (
							<button
								key={m.id}
								type="button"
								class="sidebar-item"
								aria-pressed={active}
								onClick={() => onToggleMarker(m.id)}
							>
								{m.color ? <ColorDot color={m.color} /> : <Icon name="tag" />}
								<span class="sidebar-item-label" title={m.name}>
									{m.name}
								</span>
								<span class="org-count">{counts.byMarker.get(m.id) ?? 0}</span>
							</button>
						);
					})
				)}
			</div>

			<div class="sidebar-group">
				<div class="sidebar-group-head">
					<span class="sidebar-heading">Osoby</span>
				</div>
				<button
					type="button"
					class="sidebar-item"
					title={
						contactSuggestionsCount > 0
							? `Znajomi — proponowani ze współpracy: ${contactSuggestionsCount}`
							: undefined
					}
					onClick={() => {
						onManageContacts();
						onPickClose?.();
					}}
				>
					<Icon name="users" />
					<span class="sidebar-item-label">Znajomi</span>
					{contactSuggestionsCount > 0 && (
						<span class="sidebar-suggest-dot" aria-hidden="true" />
					)}
					{contactsCount > 0 && <span class="org-count">{contactsCount}</span>}
				</button>
			</div>

			<p class="sidebar-privacy muted">
				<Icon name="lock" />
				<span>Foldery i etykiety widzisz tylko Ty.</span>
			</p>
		</nav>
	);
}
