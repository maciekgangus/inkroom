import {
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "preact/hooks";
import { AccountDialog } from "./account-dialog";
import type {
	Account,
	BoardFolder,
	BoardMarker,
	BoardSummary,
	ContactSuggestion,
} from "./api";
import * as api from "./api";
import { avatarUrl } from "./avatars";
import {
	type BoardFilter,
	type BoardSort,
	DEFAULT_FILTER,
	filterBoards,
	formatSize,
	type GroupBy,
	hasPopoverFilters,
	isFiltering,
	sortDirectionLabel,
} from "./board-filter";
import {
	type BoardEntry,
	groupBoards,
	moveItem,
	nudgeItem,
	type OrgSuggestion,
	suggestOrganization,
} from "./board-organize";
import {
	BoardOrganizeDialog,
	ColorDot,
	FolderDialog,
	MarkersDialog,
} from "./board-organize-dialog";
import { BoardOwnersDialog, BulkTransferDialog } from "./board-owners-dialog";
import { BoardPreview } from "./board-preview";
import { CONTACT_SOURCE_LABEL, ContactsDialog } from "./contacts-dialog";
import { FeedbackButton } from "./feedback-button";
import { Icon, type IconName } from "./icon";
import { Logo } from "./logo";
import { PanelSidebar } from "./panel-sidebar";
import { PersonPopover, type PersonPopoverAction } from "./person-popover";
import { Segmented } from "./segmented";
import { ThemeToggle } from "./theme";
import { versionWatch } from "./version";

const VIEW_KEY = "inkroom.boardView";
const FILTER_KEY = "inkroom.panelFilter";
const DISMISSED_KEY = "inkroom.dismissedSuggestions";
type View = "list" | "tiles";

interface ToastState {
	message: string;
	tone?: "default" | "error";
	undoLabel?: string;
	onUndo?: () => Promise<void> | void;
}

const storedView = (): View => {
	try {
		return localStorage.getItem(VIEW_KEY) === "list" ? "list" : "tiles";
	} catch {
		return "tiles";
	}
};

const storedFilter = (): BoardFilter => {
	try {
		const raw = sessionStorage.getItem(FILTER_KEY);
		if (!raw) return DEFAULT_FILTER;
		const parsed = JSON.parse(raw) as Partial<BoardFilter>;
		return {
			...DEFAULT_FILTER,
			scope:
				parsed.scope === "mine" || parsed.scope === "shared"
					? parsed.scope
					: "all",
			range:
				parsed.range === "today" ||
				parsed.range === "7" ||
				parsed.range === "30"
					? parsed.range
					: "any",
			sort:
				parsed.sort === "name" ||
				parsed.sort === "size" ||
				parsed.sort === "custom"
					? parsed.sort
					: "changed",
			reversed: Boolean(parsed.reversed),
			folder: typeof parsed.folder === "string" ? parsed.folder : "all",
			markerIds: Array.isArray(parsed.markerIds)
				? parsed.markerIds.map(String)
				: [],
			pinnedOnly: Boolean(parsed.pinnedOnly),
			groupBy:
				parsed.groupBy === "folder" ||
				parsed.groupBy === "marker" ||
				parsed.groupBy === "date" ||
				parsed.groupBy === "owner"
					? parsed.groupBy
					: "none",
		};
	} catch {
		return DEFAULT_FILTER;
	}
};

const storedDismissed = (): Set<string> => {
	try {
		const raw = localStorage.getItem(DISMISSED_KEY);
		if (!raw) return new Set();
		const arr = JSON.parse(raw);
		return Array.isArray(arr) ? new Set(arr.map(String)) : new Set();
	} catch {
		return new Set();
	}
};

const GROUP_LABELS: Record<GroupBy, string> = {
	none: "Brak",
	folder: "Foldery",
	marker: "Etykiety",
	date: "Czas",
	owner: "Właściciel",
};

const RANGE_LABELS: Record<BoardFilter["range"], string> = {
	any: "Zawsze",
	today: "Dziś",
	"7": "7 dni",
	"30": "30 dni",
};

const SORT_LABELS: Record<BoardSort, string> = {
	changed: "Ostatnie",
	name: "Nazwa",
	size: "Największe",
	custom: "Własna",
};

interface Props {
	account: Account;
	navigate: (to: string) => void;
	onLogout: () => void;
	/** The account changed in the account window (its picture, R-111). */
	onAccount?: (account: Account) => void;
}

/**
 * The logged-in user's Quiet Desk home: left folder/label navigation, always-visible search,
 * folded filters/sort/grouping, calm cards with double-click rename and overflow menu, and toasts.
 */
export function Panel({ account, navigate, onLogout, onAccount }: Props) {
	const [accountOpen, setAccountOpen] = useState(false);
	const [owned, setOwned] = useState<BoardSummary[] | null>(null);
	const [visited, setVisited] = useState<BoardSummary[]>([]);
	const [folders, setFolders] = useState<BoardFolder[]>([]);
	const [markers, setMarkers] = useState<BoardMarker[]>([]);
	const [loadError, setLoadError] = useState("");
	const [creating, setCreating] = useState(false);
	const [view, setViewState] = useState<View>(storedView);
	const [filter, setFilterState] = useState<BoardFilter>(storedFilter);
	const [filterOpen, setFilterOpen] = useState(false);
	const [drawerOpen, setDrawerOpen] = useState(false);

	// Dialog & organization state (R-121).
	const [folderDialog, setFolderDialog] = useState<
		| { open: true; folder: BoardFolder | null; confirmDelete?: boolean }
		| { open: false }
	>({ open: false });
	const [markersOpen, setMarkersOpen] = useState(false);
	const [organizeBoards, setOrganizeBoards] = useState<BoardSummary[] | null>(
		null,
	);
	const [ownersBoard, setOwnersBoard] = useState<BoardSummary | null>(null);
	const [bulkTransferOpen, setBulkTransferOpen] = useState(false);
	const [contacts, setContacts] = useState<ContactSuggestion[]>([]);
	const [contactsOpen, setContactsOpen] = useState(false);
	const [personPopover, setPersonPopover] = useState<{
		username: string;
		x: number;
		y: number;
		board?: BoardSummary;
		mine?: boolean;
	} | null>(null);
	const [selectMode, setSelectMode] = useState(false);
	const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
	const [bulkConfirmDelete, setBulkConfirmDelete] = useState(false);
	const lastSelectedRef = useRef<string | null>(null);
	const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
		() => new Set(),
	);
	const [dismissedSuggestions, setDismissedSuggestions] =
		useState<Set<string>>(storedDismissed);
	// Collapsed by default so boards own the viewport immediately.
	const [suggestionsOpen, setSuggestionsOpen] = useState(false);
	const [busySuggestionId, setBusySuggestionId] = useState<string | null>(null);
	const [dragBoardId, setDragBoardId] = useState<string | null>(null);
	const [dropFolderId, setDropFolderId] = useState<string | null>(null);
	const [toast, setToast] = useState<ToastState | null>(null);

	const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
	const searchInputRef = useRef<HTMLInputElement>(null);
	const createInputRef = useRef<HTMLInputElement>(null);

	const showToast = (next: ToastState) => {
		clearTimeout(toastTimer.current);
		setToast(next);
		toastTimer.current = setTimeout(
			() => setToast(null),
			next.onUndo ? 7000 : 4000,
		);
	};

	useEffect(() => () => clearTimeout(toastTimer.current), []);

	const setFilter = (next: BoardFilter) => {
		setFilterState(next);
		try {
			const { query: _q, ...persisted } = next;
			sessionStorage.setItem(FILTER_KEY, JSON.stringify(persisted));
		} catch {
			// Ignore storage errors.
		}
	};

	const patch = (p: Partial<BoardFilter>) => setFilter({ ...filter, ...p });

	const setView = (v: View) => {
		setViewState(v);
		try {
			localStorage.setItem(VIEW_KEY, v);
		} catch {
			// The choice is just not remembered.
		}
	};

	const loading = useRef(false);
	const load = (quiet: boolean) => {
		if (loading.current) return;
		loading.current = true;
		if (!quiet) setLoadError("");
		api
			.listBoards()
			.then((l) => {
				setOwned(l.owned);
				setVisited(l.visited);
				setFolders(l.folders ?? []);
				setMarkers(l.markers ?? []);
				setLoadError("");
			})
			.catch((e) => {
				if (!quiet) setLoadError(api.errorMessage(e));
			})
			.finally(() => {
				loading.current = false;
			});
	};

	const loadContacts = () => {
		api
			.listContacts()
			.then((res) => setContacts(res.contacts ?? []))
			.catch(() => {
				// Keep existing list if contacts cannot be refreshed.
			});
	};

	useEffect(() => {
		load(false);
		loadContacts();
		void versionWatch.check();
		const refresh = () => {
			load(true);
			void versionWatch.check();
		};
		const shown = (e: Event) => {
			if ((e as PageTransitionEvent).persisted) refresh();
		};
		const visible = () => {
			if (document.visibilityState === "visible") refresh();
		};
		window.addEventListener("pageshow", shown);
		window.addEventListener("focus", refresh);
		document.addEventListener("visibilitychange", visible);
		return () => {
			window.removeEventListener("pageshow", shown);
			window.removeEventListener("focus", refresh);
			document.removeEventListener("visibilitychange", visible);
		};
	}, []);

	// Panel keyboard shortcuts: "/" focuses search, "Escape" exits select mode / drawer / filter popover.
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			const target = e.target as HTMLElement | null;
			const inField =
				target &&
				(target.tagName === "INPUT" ||
					target.tagName === "TEXTAREA" ||
					target.isContentEditable);
			if (e.key === "/" && !inField && !e.ctrlKey && !e.metaKey && !e.altKey) {
				e.preventDefault();
				searchInputRef.current?.focus();
				return;
			}
			if (e.key === "Escape") {
				if (
					folderDialog.open ||
					markersOpen ||
					organizeBoards ||
					ownersBoard ||
					bulkTransferOpen ||
					contactsOpen ||
					personPopover ||
					accountOpen
				) {
					return;
				}
				if (drawerOpen) {
					setDrawerOpen(false);
				} else if (filterOpen && !inField) {
					setFilterOpen(false);
				} else if (selectMode) {
					setSelectMode(false);
					setSelectedIds(new Set());
					setBulkConfirmDelete(false);
				}
			}
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [
		drawerOpen,
		filterOpen,
		selectMode,
		organizeBoards,
		ownersBoard,
		bulkTransferOpen,
		contactsOpen,
		personPopover,
		folderDialog.open,
		markersOpen,
		accountOpen,
	]);

	const activeFolderId =
		filter.folder && filter.folder !== "all" && filter.folder !== "unfiled"
			? filter.folder
			: undefined;
	const activeFolderObj = folders.find((f) => f.id === activeFolderId);

	const create = async (form: HTMLFormElement) => {
		if (creating) return;
		const name = String(new FormData(form).get("name") ?? "").trim();
		setCreating(true);
		try {
			const b = await api.createBoard(name, activeFolderId);
			navigate(`/b/${b.id}`);
		} catch (e) {
			showToast({ message: api.errorMessage(e), tone: "error" });
			setCreating(false);
		}
	};

	const logout = async () => {
		await api.logout().catch(() => {});
		onLogout();
	};

	const updateBoardLocal = (
		ids: string[],
		fn: (b: BoardSummary) => BoardSummary,
	) => {
		const idSet = new Set(ids);
		setOwned((cur) =>
			cur ? cur.map((b) => (idSet.has(b.id) ? fn(b) : b)) : cur,
		);
		setVisited((cur) => cur.map((b) => (idSet.has(b.id) ? fn(b) : b)));
	};

	const togglePin = async (board: BoardSummary) => {
		const next = !board.pinned;
		updateBoardLocal([board.id], (b) => ({ ...b, pinned: next }));
		try {
			await api.updateBoardMeta(board.id, { pinned: next });
			showToast({
				message: next ? `Przypięto „${board.name}”` : `Odpięto „${board.name}”`,
			});
		} catch (e) {
			updateBoardLocal([board.id], (b) => ({ ...b, pinned: board.pinned }));
			showToast({ message: api.errorMessage(e), tone: "error" });
		}
	};

	const moveBoardToFolder = async (boardId: string, targetFolderId: string) => {
		const all = [...(owned ?? []), ...visited];
		const board = all.find((b) => b.id === boardId);
		const prev = board?.folderId;
		if ((prev ?? "") === targetFolderId) return;
		updateBoardLocal([boardId], (b) => ({
			...b,
			folderId: targetFolderId || undefined,
		}));
		try {
			await api.updateBoardMeta(boardId, { folderId: targetFolderId });
			const targetName = targetFolderId
				? folders.find((f) => f.id === targetFolderId)?.name
				: undefined;
			showToast({
				message: targetName
					? `Przeniesiono do „${targetName}”`
					: "Przeniesiono do „Bez folderu”",
				undoLabel: "Cofnij",
				onUndo: async () => {
					updateBoardLocal([boardId], (b) => ({ ...b, folderId: prev }));
					await api.updateBoardMeta(boardId, { folderId: prev ?? "" });
				},
			});
		} catch (e) {
			updateBoardLocal([boardId], (b) => ({ ...b, folderId: prev }));
			showToast({ message: api.errorMessage(e), tone: "error" });
		}
	};

	const reorderFolder = async (id: string, delta: -1 | 1) => {
		const prevFolders = folders;
		const ids = folders.map((f) => f.id);
		const nextIds = nudgeItem(ids, id, delta);
		if (nextIds === ids) return;
		const byId = new Map(folders.map((f) => [f.id, f]));
		const nextFolders = nextIds
			.map((fid, i) => {
				const f = byId.get(fid);
				return f ? { ...f, position: i } : null;
			})
			.filter((f): f is BoardFolder => Boolean(f));
		setFolders(nextFolders);
		try {
			await Promise.all(
				nextFolders.map((f, i) =>
					f.position !== prevFolders.find((x) => x.id === f.id)?.position
						? api.updateFolder(f.id, { position: i })
						: Promise.resolve(),
				),
			);
		} catch (e) {
			setFolders(prevFolders);
			showToast({ message: api.errorMessage(e), tone: "error" });
		}
	};

	const applyOrganizePatch = (p: {
		boardIds: string[];
		folderId?: string;
		pinned?: boolean;
		markerIds?: string[];
		addMarkerIds?: string[];
		removeMarkerIds?: string[];
	}) => {
		updateBoardLocal(p.boardIds, (b) => {
			let nextMarkers = b.markerIds ?? [];
			if (p.markerIds !== undefined) {
				nextMarkers = p.markerIds;
			} else {
				const set = new Set(nextMarkers);
				for (const id of p.addMarkerIds ?? []) set.add(id);
				for (const id of p.removeMarkerIds ?? []) set.delete(id);
				nextMarkers = [...set];
			}
			return {
				...b,
				folderId:
					p.folderId !== undefined ? p.folderId || undefined : b.folderId,
				pinned: p.pinned !== undefined ? p.pinned : b.pinned,
				markerIds: nextMarkers.length > 0 ? nextMarkers : undefined,
			};
		});
		if (selectMode && p.boardIds.length > 1) {
			setSelectedIds(new Set());
			setSelectMode(false);
			setBulkConfirmDelete(false);
		}
		showToast({
			message:
				p.boardIds.length === 1
					? "Zapisano organizację tablicy"
					: `Zaktualizowano ${p.boardIds.length} tablic`,
		});
	};

	const bulkPin = async (pinValue: boolean) => {
		const ids = [...selectedIds];
		if (ids.length === 0) return;
		try {
			await api.bulkOrganizeBoards({ boardIds: ids, pinned: pinValue });
			applyOrganizePatch({ boardIds: ids, pinned: pinValue });
		} catch (e) {
			showToast({ message: api.errorMessage(e), tone: "error" });
		}
	};

	const bulkDeleteOwned = async () => {
		const ownedSet = new Set((owned ?? []).map((b) => b.id));
		const ids = [...selectedIds].filter((id) => ownedSet.has(id));
		if (ids.length === 0) return;
		try {
			await Promise.all(ids.map((id) => api.deleteBoard(id)));
			const removed = new Set(ids);
			setOwned((cur) => (cur ? cur.filter((b) => !removed.has(b.id)) : cur));
			setSelectedIds(new Set());
			setSelectMode(false);
			setBulkConfirmDelete(false);
			showToast({ message: `Usunięto ${ids.length} tablic` });
		} catch (e) {
			showToast({ message: api.errorMessage(e), tone: "error" });
		}
	};

	const persistCustomOrder = async (nextIds: string[]) => {
		const prevOwned = owned;
		const prevVisited = visited;
		const posById = new Map(nextIds.map((id, i) => [id, i + 1]));
		updateBoardLocal(nextIds, (b) => ({
			...b,
			position: posById.get(b.id) ?? b.position,
		}));
		try {
			await api.setBoardOrder(nextIds);
		} catch (e) {
			setOwned(prevOwned);
			setVisited(prevVisited);
			showToast({ message: api.errorMessage(e), tone: "error" });
		}
	};

	const dismissSuggestion = (id: string) => {
		const next = new Set(dismissedSuggestions);
		next.add(id);
		setDismissedSuggestions(next);
		try {
			localStorage.setItem(DISMISSED_KEY, JSON.stringify([...next]));
		} catch {
			// Ignore storage failures.
		}
	};

	const restoreDismissed = () => {
		setDismissedSuggestions(new Set());
		try {
			localStorage.removeItem(DISMISSED_KEY);
		} catch {
			// Ignore.
		}
	};

	const applySuggestion = async (s: OrgSuggestion) => {
		if (busySuggestionId) return;
		setBusySuggestionId(s.id);
		const prevFoldersByBoard = new Map(
			allBoards
				.filter((b) => s.boardIds.includes(b.id))
				.map((b) => [b.id, b.folderId ?? ""]),
		);
		try {
			if (s.kind === "move-to-folder") {
				await api.bulkOrganizeBoards({
					boardIds: s.boardIds,
					folderId: s.folderId,
				});
				applyOrganizePatch({ boardIds: s.boardIds, folderId: s.folderId });
				showToast({
					message: s.title,
					undoLabel: "Cofnij",
					onUndo: async () => {
						await Promise.all(
							s.boardIds.map((bid) =>
								api.updateBoardMeta(bid, {
									folderId: prevFoldersByBoard.get(bid) ?? "",
								}),
							),
						);
						for (const bid of s.boardIds) {
							const prev = prevFoldersByBoard.get(bid) || undefined;
							updateBoardLocal([bid], (b) => ({ ...b, folderId: prev }));
						}
					},
				});
			} else if (s.kind === "create-folder") {
				const created = await api.createFolder(s.folderName, s.color);
				setFolders((cur) => [...cur, created]);
				await api.bulkOrganizeBoards({
					boardIds: s.boardIds,
					folderId: created.id,
				});
				applyOrganizePatch({ boardIds: s.boardIds, folderId: created.id });
				showToast({
					message: `Utworzono folder „${created.name}”`,
					undoLabel: "Cofnij",
					onUndo: async () => {
						await api.deleteFolder(created.id);
						setFolders((cur) => cur.filter((f) => f.id !== created.id));
						for (const bid of s.boardIds) {
							const prev = prevFoldersByBoard.get(bid) || undefined;
							updateBoardLocal([bid], (b) => ({ ...b, folderId: prev }));
						}
					},
				});
			} else if (s.kind === "apply-marker") {
				let markerId = s.markerId;
				let createdNew = false;
				if (!markerId) {
					const created = await api.createMarker(s.markerName, s.color);
					setMarkers((cur) => [...cur, created]);
					markerId = created.id;
					createdNew = true;
				}
				const appliedMarkerId = markerId;
				await api.bulkOrganizeBoards({
					boardIds: s.boardIds,
					addMarkerIds: [appliedMarkerId],
				});
				applyOrganizePatch({
					boardIds: s.boardIds,
					addMarkerIds: [appliedMarkerId],
				});
				showToast({
					message: `Dodano etykietę „${s.markerName}”`,
					undoLabel: "Cofnij",
					onUndo: async () => {
						if (createdNew) {
							await api.deleteMarker(appliedMarkerId);
							setMarkers((cur) => cur.filter((m) => m.id !== appliedMarkerId));
						} else {
							await api.bulkOrganizeBoards({
								boardIds: s.boardIds,
								removeMarkerIds: [appliedMarkerId],
							});
						}
						updateBoardLocal(s.boardIds, (b) => ({
							...b,
							markerIds: b.markerIds?.filter((id) => id !== appliedMarkerId),
						}));
					},
				});
			}
		} catch (e) {
			showToast({ message: api.errorMessage(e), tone: "error" });
		} finally {
			setBusySuggestionId(null);
		}
	};

	const lookup = useMemo(() => ({ folders, markers }), [folders, markers]);
	const folderMap = useMemo(
		() => new Map(folders.map((f) => [f.id, f])),
		[folders],
	);
	const markerMap = useMemo(
		() => new Map(markers.map((m) => [m.id, m])),
		[markers],
	);

	const allBoards = useMemo(
		() => [...(owned ?? []), ...visited],
		[owned, visited],
	);

	const counts = useMemo(() => {
		const byFolder = new Map<string, number>();
		const byMarker = new Map<string, number>();
		let unfiled = 0;
		let pinned = 0;
		for (const b of allBoards) {
			if (b.pinned) pinned++;
			if (b.folderId && folderMap.has(b.folderId)) {
				byFolder.set(b.folderId, (byFolder.get(b.folderId) ?? 0) + 1);
			} else {
				unfiled++;
			}
			for (const id of b.markerIds ?? []) {
				if (markerMap.has(id)) byMarker.set(id, (byMarker.get(id) ?? 0) + 1);
			}
		}
		return {
			total: allBoards.length,
			owned: owned?.length ?? 0,
			visited: visited.length,
			pinned,
			unfiled,
			byFolder,
			byMarker,
		};
	}, [allBoards, owned, visited, folderMap, markerMap]);

	const suggestions = useMemo(
		() =>
			owned === null
				? []
				: suggestOrganization({
						boards: allBoards,
						folders,
						markers,
						dismissed: dismissedSuggestions,
					}),
		[owned, allBoards, folders, markers, dismissedSuggestions],
	);

	const ownedShown = useMemo(
		() =>
			owned && filter.scope !== "shared"
				? filterBoards(owned, filter, undefined, lookup)
				: [],
		[owned, filter, lookup],
	);
	const visitedShown = useMemo(
		() =>
			filter.scope !== "mine"
				? filterBoards(visited, filter, undefined, lookup)
				: [],
		[visited, filter, lookup],
	);
	const ownedShownIds = useMemo(
		() => ownedShown.map((b) => b.id),
		[ownedShown],
	);
	const visitedShownIds = useMemo(
		() => visitedShown.map((b) => b.id),
		[visitedShown],
	);
	const allVisibleIds = useMemo(
		() => [...ownedShownIds, ...visitedShownIds],
		[ownedShownIds, visitedShownIds],
	);

	const totalCount = (owned?.length ?? 0) + visited.length;
	const visibleCount = ownedShown.length + visitedShown.length;
	const narrowing = isFiltering(filter) && visibleCount < totalCount;

	const combinedShownEntries: BoardEntry[] = useMemo(() => {
		const entries: BoardEntry[] = [
			...ownedShown.map((board) => ({ board, mine: true })),
			...visitedShown.map((board) => ({ board, mine: false })),
		];
		if (filter.groupBy && filter.groupBy !== "none") {
			const sortedIds = new Map(
				filterBoards(
					entries.map((e) => e.board),
					filter,
					undefined,
					lookup,
				).map((b, i) => [b.id, i]),
			);
			entries.sort(
				(a, b) =>
					(sortedIds.get(a.board.id) ?? 0) - (sortedIds.get(b.board.id) ?? 0),
			);
		}
		return entries;
	}, [ownedShown, visitedShown, filter, lookup]);

	const groups = useMemo(() => {
		if (!filter.groupBy || filter.groupBy === "none") return null;
		return groupBoards(
			combinedShownEntries,
			filter.groupBy,
			folders,
			markers,
			undefined,
			filter.groupBy === "folder" &&
				!filter.query.trim() &&
				(filter.folder ?? "all") === "all",
		);
	}, [
		combinedShownEntries,
		filter.groupBy,
		filter.query,
		filter.folder,
		folders,
		markers,
	]);

	const toggleMarkerFilter = (id: string) => {
		const cur = filter.markerIds ?? [];
		const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
		patch({ markerIds: next });
	};

	const toggleSelectBoard = (
		id: string,
		siblingIds: string[],
		shiftKey = false,
	) => {
		const next = new Set(selectedIds);
		if (shiftKey && lastSelectedRef.current) {
			const a = siblingIds.indexOf(lastSelectedRef.current);
			const b = siblingIds.indexOf(id);
			if (a >= 0 && b >= 0) {
				const [start, end] = a < b ? [a, b] : [b, a];
				for (let i = start; i <= end; i++) next.add(siblingIds[i]);
				setSelectedIds(next);
				return;
			}
		}
		if (next.has(id)) next.delete(id);
		else next.add(id);
		lastSelectedRef.current = id;
		setSelectedIds(next);
	};

	const toggleCollapseGroup = (key: string) => {
		const next = new Set(collapsedGroups);
		if (next.has(key)) next.delete(key);
		else next.add(key);
		setCollapsedGroups(next);
	};

	const customOrderActive = filter.sort === "custom";
	const hideFolderTag = Boolean(activeFolderId) || filter.groupBy === "folder";

	const activeViewLabel = filter.pinnedOnly
		? "Przypięte"
		: activeFolderObj
			? activeFolderObj.name
			: filter.folder === "unfiled"
				? "Bez folderu"
				: filter.scope === "mine"
					? "Moje tablice"
					: filter.scope === "shared"
						? "Udostępnione"
						: "Wszystko";

	const isEmptyFolderView =
		Boolean(activeFolderObj) &&
		(counts.byFolder.get(activeFolderObj?.id ?? "") ?? 0) === 0 &&
		!isFiltering(filter);
	const isScopedNav = filter.folder !== "all" || Boolean(filter.pinnedOnly);
	const showScopedEmpty =
		!isFiltering(filter) && isScopedNav && !isEmptyFolderView;

	const noMatch =
		isEmptyFolderView && activeFolderObj ? (
			<div class="empty-folder-card">
				<p class="empty-folder-title">
					Folder „{activeFolderObj.name}” jest pusty
				</p>
				<p class="muted">
					Utwórz tutaj nową tablicę albo przeciągnij istniejącą z innej listy.
				</p>
				<button
					type="button"
					class="primary"
					onClick={() => createInputRef.current?.focus()}
				>
					Utwórz tablicę w tym folderze
				</button>
			</div>
		) : showScopedEmpty ? (
			<div class="empty-filter-row">
				<p class="muted">
					{filter.pinnedOnly
						? "Brak przypiętych tablic."
						: "Wszystkie tablice są już przypisane do folderów."}
				</p>
				<button
					type="button"
					class="filter-reset"
					onClick={() => patch({ folder: "all", pinnedOnly: false })}
				>
					Pokaż wszystkie tablice
				</button>
			</div>
		) : (
			<div class="empty-filter-row">
				<p class="muted">Żadna tablica nie pasuje do filtra.</p>
				{isFiltering(filter) && (
					<button
						type="button"
						class="filter-reset"
						onClick={() =>
							setFilter({
								...DEFAULT_FILTER,
								folder: filter.folder,
								pinnedOnly: filter.pinnedOnly,
							})
						}
					>
						Wyczyść filtry
					</button>
				)}
			</div>
		);

	// Active filter/sort/group summary chips shown when filter popover is closed.
	const summaryChips: { key: string; label: string; clear: () => void }[] = [];
	if (!filterOpen) {
		if (filter.range !== "any") {
			summaryChips.push({
				key: "range",
				label: `Zmieniona: ${RANGE_LABELS[filter.range]}`,
				clear: () => patch({ range: "any" }),
			});
		}
		if (filter.sort !== "changed" || filter.reversed) {
			summaryChips.push({
				key: "sort",
				label:
					filter.sort === "custom"
						? "Kolejność: Własna"
						: `Kolejność: ${SORT_LABELS[filter.sort]} (${sortDirectionLabel(filter.sort, Boolean(filter.reversed))})`,
				clear: () => patch({ sort: "changed", reversed: false }),
			});
		}
		if (filter.groupBy && filter.groupBy !== "none") {
			summaryChips.push({
				key: "group",
				label: `Grupowanie: ${GROUP_LABELS[filter.groupBy]}`,
				clear: () => patch({ groupBy: "none" }),
			});
		}
		for (const mid of filter.markerIds ?? []) {
			const m = markerMap.get(mid);
			if (m) {
				summaryChips.push({
					key: `marker:${mid}`,
					label: `Etykieta: ${m.name}`,
					clear: () => toggleMarkerFilter(mid),
				});
			}
		}
	}

	const contactByName = useMemo(() => {
		const m = new Map<string, ContactSuggestion>();
		for (const c of contacts) m.set(c.username.toLowerCase(), c);
		return m;
	}, [contacts]);

	const savedFriendNames = useMemo(() => {
		const s = new Set<string>();
		for (const c of contacts) {
			if (c.saved) s.add(c.username.toLowerCase());
		}
		return s;
	}, [contacts]);

	const boardCountsByPerson = useMemo(() => {
		const countsMap = new Map<string, number>();
		const selfKey = account.username.toLowerCase();
		const bump = (name: string | undefined, seenOnBoard: Set<string>) => {
			if (!name) return;
			const key = name.toLowerCase();
			if (key === selfKey || seenOnBoard.has(key)) return;
			seenOnBoard.add(key);
			countsMap.set(key, (countsMap.get(key) ?? 0) + 1);
		};
		for (const b of owned ?? []) {
			const seen = new Set<string>();
			for (const u of b.owners ?? []) bump(u, seen);
		}
		for (const b of visited) {
			const seen = new Set<string>();
			bump(b.owner, seen);
			for (const u of b.owners ?? []) bump(u, seen);
		}
		return countsMap;
	}, [owned, visited, account.username]);

	const addFriendQuick = async (loginOrId: string | number) => {
		try {
			const res = await api.addContact(loginOrId);
			setContacts(res.contacts);
			showToast({ message: `Dodano „${res.contact.username}” do znajomych` });
		} catch (e) {
			showToast({ message: api.errorMessage(e), tone: "error" });
		}
	};

	const removeFriendQuick = async (contact: ContactSuggestion) => {
		try {
			const res = await api.removeContact(contact.id);
			setContacts(res.contacts);
			showToast({
				message: `Usunięto „${contact.username}” ze znajomych`,
				onUndo: async () => {
					// By id only people still connected qualify; the username always works.
					const restored = await api.addContact(contact.username);
					setContacts(restored.contacts);
				},
			});
		} catch (e) {
			showToast({ message: api.errorMessage(e), tone: "error" });
		}
	};

	const filterByPerson = (username: string) => {
		patch({
			query: username,
			scope: "all",
			folder: "all",
			pinnedOnly: false,
			markerIds: [],
		});
	};

	const renderBoardRow = (
		b: BoardSummary,
		mine: boolean,
		siblingIds: string[],
		idx: number,
	) => {
		const folder =
			!hideFolderTag && b.folderId ? folderMap.get(b.folderId) : undefined;
		const boardMarkers = (b.markerIds ?? [])
			.map((id) => markerMap.get(id))
			.filter((m): m is BoardMarker => Boolean(m));
		return (
			<BoardRow
				key={b.id}
				board={b}
				mine={mine}
				tiles={view === "tiles"}
				folder={folder}
				markers={boardMarkers}
				navigate={navigate}
				selectMode={selectMode}
				selected={selectedIds.has(b.id)}
				onToggleSelect={(shift) => toggleSelectBoard(b.id, siblingIds, shift)}
				onTogglePin={() => void togglePin(b)}
				onOrganize={() => setOrganizeBoards([b])}
				onManageOwners={
					mine
						? () => {
								loadContacts();
								setOwnersBoard(b);
							}
						: undefined
				}
				currentUsername={account.username}
				savedFriendNames={savedFriendNames}
				onOpenPerson={(username, at) =>
					setPersonPopover({ username, x: at.x, y: at.y, board: b, mine })
				}
				onQuickAddFriend={(username) => void addFriendQuick(username)}
				onNotify={(message) => showToast({ message })}
				customOrder={customOrderActive}
				canMoveUp={customOrderActive && idx > 0}
				canMoveDown={customOrderActive && idx < siblingIds.length - 1}
				onMoveUp={() => {
					const next = nudgeItem(siblingIds, b.id, -1);
					if (next !== siblingIds) void persistCustomOrder(next);
				}}
				onMoveDown={() => {
					const next = nudgeItem(siblingIds, b.id, 1);
					if (next !== siblingIds) void persistCustomOrder(next);
				}}
				dragging={dragBoardId === b.id}
				onDragStart={() => setDragBoardId(b.id)}
				onDragEnd={() => {
					setDragBoardId(null);
					setDropFolderId(null);
				}}
				onDropOnBoard={(sourceId) => {
					if (customOrderActive && sourceId !== b.id) {
						const next = moveItem(siblingIds, sourceId, b.id);
						if (next !== siblingIds) void persistCustomOrder(next);
					}
					setDragBoardId(null);
				}}
				onRenamed={
					mine
						? (name) => {
								setOwned((cur) =>
									cur
										? cur.map((x) => (x.id === b.id ? { ...x, name } : x))
										: cur,
								);
								showToast({ message: `Zmieniono nazwę na „${name}”` });
							}
						: undefined
				}
				onDeleted={
					mine
						? () => {
								setOwned((cur) =>
									cur ? cur.filter((x) => x.id !== b.id) : cur,
								);
								showToast({ message: `Usunięto „${b.name}”` });
							}
						: undefined
				}
				onCopied={
					mine
						? (copy) => {
								// Keep the new copy visible in the active folder right away if copied from one.
								const targetFolder = b.folderId ?? activeFolderId;
								if (targetFolder) {
									void api
										.updateBoardMeta(copy.id, { folderId: targetFolder })
										.catch(() => {});
								}
								setOwned((cur) =>
									cur
										? [
												{
													...copy,
													folderId: targetFolder,
													updatedAt: new Date().toISOString(),
												},
												...cur,
											]
										: cur,
								);
								showToast({ message: `Utworzono kopię „${copy.name}”` });
							}
						: undefined
				}
				onForgotten={
					!mine
						? () => {
								setVisited((cur) => cur.filter((x) => x.id !== b.id));
								showToast({
									message: `Usunięto „${b.name}” z listy (link nadal działa)`,
								});
							}
						: undefined
				}
			/>
		);
	};

	const sidebarProps = {
		filter,
		folders,
		markers,
		counts,
		dragBoardId,
		dropFolderId,
		onDropFolderChange: setDropFolderId,
		onDropBoard: (boardId: string, folderId: string) => {
			setDragBoardId(null);
			void moveBoardToFolder(boardId, folderId);
		},
		onPatch: patch,
		onToggleMarker: toggleMarkerFilter,
		onNewFolder: () => setFolderDialog({ open: true, folder: null }),
		onEditFolder: (f: BoardFolder, confirmDelete = false) =>
			setFolderDialog({ open: true, folder: f, confirmDelete }),
		onReorderFolder: (id: string, delta: -1 | 1) =>
			void reorderFolder(id, delta),
		onCreateInFolder: (folderId: string) => {
			patch({ folder: folderId, pinnedOnly: false, scope: "all" });
			setTimeout(() => createInputRef.current?.focus(), 0);
		},
		onManageMarkers: () => setMarkersOpen(true),
		contactsCount: contacts.filter((c) => c.saved).length,
		contactSuggestionsCount: contacts.filter((c) => !c.saved).length,
		onManageContacts: () => {
			loadContacts();
			setContactsOpen(true);
		},
	};

	const selectedBoardsList = allBoards.filter((b) => selectedIds.has(b.id));
	const selectedOwnedBoards = selectedBoardsList.filter((b) =>
		(owned ?? []).some((o) => o.id === b.id),
	);
	const selectedOwnedCount = selectedOwnedBoards.length;
	const allVisibleSelected =
		allVisibleIds.length > 0 &&
		allVisibleIds.every((id) => selectedIds.has(id));

	return (
		<main class={`panel${selectMode ? " panel-selecting" : ""}`}>
			<header class="panel-header row between">
				<h1 class="brand">
					<Logo />
				</h1>
				<span class="row panel-header-right">
					<span class="panel-tools">
						<a
							class="panel-icon-btn"
							href="/calendar"
							aria-label="Kalendarz"
							title="Kalendarz"
						>
							<Icon name="calendar" />
						</a>
						<FeedbackButton />
						<ThemeToggle />
					</span>
					<button
						type="button"
						class="chip"
						title="Konto"
						onClick={() => setAccountOpen(true)}
					>
						<span class="chip-avatar" aria-hidden="true">
							{avatarUrl(account.avatar) ? (
								<img
									src={avatarUrl(account.avatar) ?? ""}
									alt=""
									width="30"
									height="30"
								/>
							) : (
								account.username.charAt(0)
							)}
						</span>
						{account.username}
					</button>
					<button
						type="button"
						class="panel-icon-btn"
						aria-label="Wyloguj"
						title="Wyloguj"
						onClick={logout}
					>
						<Icon name="logout" />
					</button>
				</span>
			</header>

			{accountOpen && (
				<AccountDialog
					account={account}
					onClose={() => setAccountOpen(false)}
					onDeleted={onLogout}
					onAvatar={(avatar) => onAccount?.({ ...account, avatar })}
				/>
			)}
			{folderDialog.open && (
				<FolderDialog
					folder={folderDialog.folder}
					startConfirmDelete={folderDialog.confirmDelete}
					onClose={() => setFolderDialog({ open: false })}
					onSaved={(saved) => {
						setFolders((cur) => {
							const exists = cur.some((f) => f.id === saved.id);
							return exists
								? cur.map((f) => (f.id === saved.id ? saved : f))
								: [...cur, saved];
						});
						showToast({
							message: folderDialog.folder
								? `Zapisano folder „${saved.name}”`
								: `Utworzono folder „${saved.name}”`,
						});
					}}
					onDeleted={(id) => {
						setFolders((cur) => cur.filter((f) => f.id !== id));
						if (filter.folder === id) patch({ folder: "all" });
						setOwned((cur) =>
							cur
								? cur.map((b) =>
										b.folderId === id ? { ...b, folderId: undefined } : b,
									)
								: cur,
						);
						setVisited((cur) =>
							cur.map((b) =>
								b.folderId === id ? { ...b, folderId: undefined } : b,
							),
						);
						showToast({ message: "Usunięto folder" });
					}}
				/>
			)}
			{markersOpen && (
				<MarkersDialog
					markers={markers}
					usageCounts={counts.byMarker}
					onClose={() => setMarkersOpen(false)}
					onCreated={(m) => {
						setMarkers((cur) => [...cur, m]);
						showToast({ message: `Dodano etykietę „${m.name}”` });
					}}
					onUpdated={(m) => {
						setMarkers((cur) => cur.map((x) => (x.id === m.id ? m : x)));
						showToast({ message: `Zapisano etykietę „${m.name}”` });
					}}
					onDeleted={(id) => {
						setMarkers((cur) => cur.filter((x) => x.id !== id));
						if (filter.markerIds?.includes(id)) {
							patch({
								markerIds: filter.markerIds.filter((x) => x !== id),
							});
						}
						const strip = (b: BoardSummary) =>
							b.markerIds?.includes(id)
								? {
										...b,
										markerIds: b.markerIds.filter((x) => x !== id),
									}
								: b;
						setOwned((cur) => (cur ? cur.map(strip) : cur));
						setVisited((cur) => cur.map(strip));
						showToast({ message: "Usunięto etykietę" });
					}}
				/>
			)}
			{organizeBoards && (
				<BoardOrganizeDialog
					boards={organizeBoards}
					folders={folders}
					markers={markers}
					onClose={() => setOrganizeBoards(null)}
					onFolderCreated={(f) => setFolders((cur) => [...cur, f])}
					onMarkerCreated={(m) => setMarkers((cur) => [...cur, m])}
					onApplied={applyOrganizePatch}
				/>
			)}
			{ownersBoard && (
				<BoardOwnersDialog
					board={ownersBoard}
					currentUsername={account.username}
					contacts={contacts}
					onContactsRefresh={loadContacts}
					onOpenContacts={() => {
						setOwnersBoard(null);
						loadContacts();
						setContactsOpen(true);
					}}
					onClose={() => setOwnersBoard(null)}
					onOwnersChanged={(ownersList, message) => {
						const co = ownersList.length > 1 ? ownersList : undefined;
						setOwned((cur) =>
							cur
								? cur.map((x) =>
										x.id === ownersBoard.id ? { ...x, owners: co } : x,
									)
								: cur,
						);
						showToast({ message });
					}}
					onSelfLostOwnership={(newPrimaryOwner, message) => {
						const moved: BoardSummary = {
							...ownersBoard,
							owner: newPrimaryOwner,
							owners: undefined,
						};
						setOwned((cur) =>
							cur ? cur.filter((x) => x.id !== ownersBoard.id) : cur,
						);
						setVisited((cur) => [
							moved,
							...cur.filter((x) => x.id !== ownersBoard.id),
						]);
						showToast({ message });
					}}
				/>
			)}
			{bulkTransferOpen && selectedOwnedBoards.length > 0 && (
				<BulkTransferDialog
					boards={selectedOwnedBoards}
					contacts={contacts}
					onContactsRefresh={loadContacts}
					onClose={() => setBulkTransferOpen(false)}
					onTransferred={(ids, newOwner) => {
						const movedSet = new Set(ids);
						const moved = (owned ?? [])
							.filter((b) => movedSet.has(b.id))
							.map((b) => ({
								...b,
								owner: newOwner,
								owners: undefined,
							}));
						setOwned((cur) =>
							cur ? cur.filter((b) => !movedSet.has(b.id)) : cur,
						);
						setVisited((cur) => [
							...moved,
							...cur.filter((b) => !movedSet.has(b.id)),
						]);
						setSelectedIds(new Set());
						setSelectMode(false);
						setBulkConfirmDelete(false);
						showToast({
							message: `Przekazano ${moved.length} tablic osobie „${newOwner}”`,
						});
					}}
				/>
			)}
			{contactsOpen && (
				<ContactsDialog
					contacts={contacts}
					boardCounts={boardCountsByPerson}
					onFilterByPerson={filterByPerson}
					onContactsChange={setContacts}
					onClose={() => setContactsOpen(false)}
					onNotify={(message, undo) => showToast({ message, onUndo: undo })}
				/>
			)}
			{personPopover &&
				(() => {
					const key = personPopover.username.toLowerCase();
					const existing = contactByName.get(key);
					const isFriend = Boolean(existing?.saved);
					const count = boardCountsByPerson.get(key) ?? 0;
					const rel = existing?.relation ?? existing?.source;
					const subtitleParts: string[] = [];
					if (rel && rel !== "contact") {
						subtitleParts.push(CONTACT_SOURCE_LABEL[rel]);
					} else if (personPopover.mine) {
						subtitleParts.push("Współwłaściciel");
					} else {
						subtitleParts.push("Właściciel tablicy");
					}
					if (count > 0) {
						subtitleParts.push(
							count === 1
								? "1 tablica"
								: count % 10 >= 2 &&
										count % 10 <= 4 &&
										(count % 100 < 12 || count % 100 > 14)
									? `${count} tablice`
									: `${count} tablic`,
						);
					}
					const actions: PersonPopoverAction[] = [];
					if (isFriend && existing) {
						actions.push({
							label: "Usuń ze znajomych",
							icon: "user-minus",
							onSelect: () => void removeFriendQuick(existing),
						});
					} else {
						actions.push({
							label: "Dodaj do znajomych",
							icon: "user-plus",
							tone: "accent",
							onSelect: () =>
								void addFriendQuick(existing?.id ?? personPopover.username),
						});
					}
					if (count > 0) {
						actions.push({
							label: `Pokaż tablice (${count})`,
							icon: "tiles",
							sepBefore: true,
							onSelect: () => filterByPerson(personPopover.username),
						});
					}
					if (personPopover.mine && personPopover.board) {
						const targetBoard = personPopover.board;
						actions.push({
							label: "Zarządzaj właścicielami…",
							icon: "users",
							sepBefore: count === 0,
							onSelect: () => {
								loadContacts();
								setOwnersBoard(targetBoard);
							},
						});
					}
					return (
						<PersonPopover
							x={personPopover.x}
							y={personPopover.y}
							username={personPopover.username}
							avatar={existing?.avatar}
							subtitle={subtitleParts.join(" · ")}
							isFriend={isFriend}
							actions={actions}
							onClose={() => setPersonPopover(null)}
						/>
					);
				})()}

			{drawerOpen && (
				// biome-ignore lint/a11y/noStaticElementInteractions: backdrop click closes drawer; Escape and close button are keyboard ways.
				<div
					class="sidebar-drawer-backdrop"
					role="presentation"
					onMouseDown={(e) => {
						if (e.target === e.currentTarget) setDrawerOpen(false);
					}}
				>
					<div
						class="sidebar-drawer"
						role="dialog"
						aria-modal="true"
						aria-label="Foldery i etykiety"
					>
						<div class="org-dialog-head">
							<h2 class="org-dialog-title">Foldery i etykiety</h2>
							<button
								type="button"
								class="account-close icon"
								aria-label="Zamknij panel folderów"
								onClick={() => setDrawerOpen(false)}
							>
								<Icon name="close" />
							</button>
						</div>
						<PanelSidebar
							{...sidebarProps}
							onPickClose={() => setDrawerOpen(false)}
						/>
					</div>
				</div>
			)}

			<div class="panel-shell">
				{owned !== null && (
					<aside class="panel-sidebar" aria-label="Foldery i etykiety">
						<PanelSidebar {...sidebarProps} />
					</aside>
				)}

				<div class="panel-main">
					<form
						class="row new-board-form"
						onSubmit={(e) => {
							e.preventDefault();
							void create(e.currentTarget as HTMLFormElement);
						}}
					>
						<input
							ref={createInputRef}
							name="name"
							aria-label="Nazwa nowej tablicy"
							autoComplete="off"
							placeholder={
								activeFolderObj
									? `Nowa tablica w „${activeFolderObj.name}”…`
									: "Nowa tablica…"
							}
							maxLength={100}
						/>
						<button type="submit" class="primary" disabled={creating}>
							{creating ? "Tworzenie…" : "Utwórz tablicę"}
						</button>
					</form>

					{/* Always-visible search + compact view/filter controls */}
					<div class="workspace-bar">
						<button
							type="button"
							class="mobile-folder-trigger"
							aria-expanded={drawerOpen}
							aria-label={`Foldery i etykiety: ${activeViewLabel}`}
							onClick={() => setDrawerOpen(true)}
						>
							{activeFolderObj?.color ? (
								<ColorDot color={activeFolderObj.color} />
							) : (
								<Icon name="folder" />
							)}
							<span class="mobile-folder-label">{activeViewLabel}</span>
							{(filter.markerIds?.length ?? 0) > 0 && (
								<span class="org-count">+{filter.markerIds?.length}</span>
							)}
							<Icon name="chevron-down" />
						</button>

						<div
							class={`panel-search${filter.query !== "" ? " has-query" : ""}`}
						>
							<Icon name="search" />
							<input
								ref={searchInputRef}
								name="search"
								type="search"
								aria-label="Szukaj tablic"
								autoComplete="off"
								placeholder="Szukaj tablic…"
								value={filter.query}
								onInput={(e) => patch({ query: e.currentTarget.value })}
							/>
							<div class="panel-search-end">
								{filter.query !== "" && (
									<button
										type="button"
										class="icon-btn"
										aria-label="Skasuj tekst"
										title="Skasuj tekst"
										onClick={() => patch({ query: "" })}
									>
										<Icon name="close" />
									</button>
								)}
								<span class="panel-search-sep" aria-hidden="true" />
								<button
									type="button"
									class="icon-btn search-filter-btn"
									aria-label="Filtr"
									title="Filtry, sortowanie i grupowanie"
									aria-expanded={filterOpen}
									aria-pressed={hasPopoverFilters(filter)}
									onClick={() => setFilterOpen(!filterOpen)}
								>
									<Icon name="sliders" />
									{hasPopoverFilters(filter) && (
										<span class="filter-active-dot" aria-hidden="true" />
									)}
								</button>
							</div>
						</div>

						<div class="workspace-actions">
							{totalCount > 0 && (
								<button
									type="button"
									class="icon-btn"
									aria-label="Zaznacz wiele"
									title="Zaznacz wiele"
									aria-pressed={selectMode}
									onClick={() => {
										if (selectMode) {
											setSelectedIds(new Set());
											setBulkConfirmDelete(false);
										}
										setSelectMode(!selectMode);
									}}
								>
									<Icon name="checklist" />
								</button>
							)}
							<fieldset
								class="view-switch view-switch-segmented"
								aria-label="Widok listy tablic"
							>
								<button
									type="button"
									class="icon-btn"
									aria-label="Lista"
									title="Lista"
									aria-pressed={view === "list"}
									onClick={() => setView("list")}
								>
									<Icon name="list" />
								</button>
								<button
									type="button"
									class="icon-btn"
									aria-label="Kafelki"
									title="Kafelki"
									aria-pressed={view === "tiles"}
									onClick={() => setView("tiles")}
								>
									<Icon name="tiles" />
								</button>
							</fieldset>
						</div>
					</div>

					{/* Active summary chips when filter menu is collapsed */}
					{summaryChips.length > 0 && (
						<section class="active-chips" aria-label="Aktywne filtry">
							{summaryChips.map((chip) => (
								<button
									key={chip.key}
									type="button"
									class="active-chip"
									onClick={chip.clear}
									title={`Usuń: ${chip.label}`}
								>
									<span>{chip.label}</span>
									<Icon name="close" />
								</button>
							))}
							<button
								type="button"
								class="filter-reset"
								onClick={() =>
									setFilter({
										...DEFAULT_FILTER,
										folder: filter.folder,
										pinnedOnly: filter.pinnedOnly,
									})
								}
							>
								Wyczyść
							</button>
						</section>
					)}

					{/* Folded filter, sort & grouping panel */}
					{filterOpen && (
						<div class="filter-menu">
							<Segmented
								label="Czyje"
								value={filter.scope}
								choices={[
									{ value: "all", label: "Wszystkie" },
									{ value: "mine", label: "Moje" },
									{ value: "shared", label: "Udostępnione" },
								]}
								onChange={(scope) => patch({ scope })}
							/>
							<Segmented
								label="Zmieniona"
								value={filter.range}
								choices={[
									{ value: "any", label: "Zawsze" },
									{ value: "today", label: "Dziś" },
									{ value: "7", label: "7 dni" },
									{ value: "30", label: "30 dni" },
								]}
								onChange={(range) => patch({ range })}
							/>
							<div class="filter-sort-wrap">
								<Segmented<BoardSort>
									label="Kolejność"
									value={filter.sort}
									choices={[
										{ value: "changed", label: "Ostatnie" },
										{ value: "name", label: "Nazwa" },
										{ value: "size", label: "Największe" },
										{ value: "custom", label: "Własna" },
									]}
									onChange={(sort) => patch({ sort, reversed: false })}
								/>
								{filter.sort !== "custom" && (
									<button
										type="button"
										class="sort-dir-btn"
										aria-pressed={Boolean(filter.reversed)}
										onClick={() => patch({ reversed: !filter.reversed })}
									>
										<Icon name="arrows-ud" />
										{sortDirectionLabel(filter.sort, Boolean(filter.reversed))}
									</button>
								)}
							</div>
							<Segmented<GroupBy>
								label="Grupowanie"
								value={filter.groupBy ?? "none"}
								choices={[
									{ value: "none", label: "Brak" },
									{ value: "folder", label: "Foldery" },
									{ value: "marker", label: "Etykiety" },
									{ value: "date", label: "Czas" },
									{ value: "owner", label: "Właściciel" },
								]}
								onChange={(groupBy) => patch({ groupBy })}
							/>
							{(narrowing || isFiltering(filter)) && (
								<div class="filter-foot">
									<span class="filter-count" aria-live="polite">
										{narrowing &&
											`Pokazano ${visibleCount} z ${totalCount} tablic`}
									</span>
									{isFiltering(filter) && (
										<button
											type="button"
											class="filter-reset"
											onClick={() => setFilter(DEFAULT_FILTER)}
										>
											Wyczyść
										</button>
									)}
								</div>
							)}
						</div>
					)}

					{/* Quiet, collapsed-by-default Smart Suggestions strip */}
					{(suggestions.length > 0 || dismissedSuggestions.size > 0) &&
						owned !== null && (
							<aside
								class="org-suggestions"
								aria-label="Sugestie porządkowania"
							>
								<button
									type="button"
									class={`org-suggestions-head${suggestions.length > 0 ? " has-suggestions" : ""}`}
									aria-expanded={suggestionsOpen}
									onClick={() => setSuggestionsOpen(!suggestionsOpen)}
								>
									<Icon name="sparkle" />
									<span>
										{suggestions.length > 0
											? "Sugestie porządkowania"
											: "Odrzucone sugestie"}
									</span>
									{suggestions.length > 0 && (
										<span class="org-count">{suggestions.length}</span>
									)}
									<span class="org-spacer" />
									<span class="org-suggestions-toggle-label">
										{suggestionsOpen ? "Ukryj" : "Pokaż"}
									</span>
									<Icon
										name={suggestionsOpen ? "chevron-down" : "chevron-right"}
									/>
								</button>
								{suggestionsOpen && (
									<div class="org-suggestions-body">
										{suggestions.length > 0 && (
											<ul class="org-suggestions-list">
												{suggestions.map((s) => {
													const preview = s.boardNames.slice(0, 3).join(", ");
													const rest = s.boardNames.length - 3;
													const isBusy = busySuggestionId === s.id;
													return (
														<li key={s.id} class="org-suggestion-item">
															<div class="org-suggestion-copy">
																<span class="org-suggestion-title">
																	<ColorDot color={s.color} />
																	{s.title}
																</span>
																<span class="muted org-suggestion-reason">
																	{s.reason}: {preview}
																	{rest > 0 ? ` (+${rest})` : ""}
																</span>
															</div>
															<div class="row">
																<button
																	type="button"
																	class="org-suggestion-apply"
																	disabled={Boolean(busySuggestionId)}
																	onClick={() => void applySuggestion(s)}
																>
																	{isBusy ? "Zapisywanie…" : "Zastosuj"}
																</button>
																<button
																	type="button"
																	class="icon-btn"
																	aria-label={`Odrzuć sugestię: ${s.title}`}
																	title="Odrzuć"
																	onClick={() => dismissSuggestion(s.id)}
																>
																	<Icon name="close" />
																</button>
															</div>
														</li>
													);
												})}
											</ul>
										)}
										{dismissedSuggestions.size > 0 && (
											<div class="org-suggestions-foot">
												<button
													type="button"
													class="filter-reset"
													onClick={restoreDismissed}
												>
													Przywróć odrzucone sugestie (
													{dismissedSuggestions.size})
												</button>
											</div>
										)}
									</div>
								)}
							</aside>
						)}

					{selectMode && (
						<div class="select-mode-banner" role="status" aria-live="polite">
							<span>
								Tryb zaznaczania — kliknij karty, aby wybrać (Shift zaznacza
								zakres).
							</span>
							<button
								type="button"
								class="filter-reset"
								onClick={() => {
									setSelectMode(false);
									setSelectedIds(new Set());
									setBulkConfirmDelete(false);
								}}
							>
								Zakończ
							</button>
						</div>
					)}

					{customOrderActive && totalCount > 1 && (
						<p class="muted org-order-hint">
							Przeciągnij tablice albo użyj strzałek, żeby ustawić własną
							kolejność.
						</p>
					)}

					{loadError && owned === null ? (
						<div class="empty-folder-card" role="alert">
							<p class="error">{loadError}</p>
							<button type="button" onClick={() => load(false)}>
								Spróbuj ponownie
							</button>
						</div>
					) : groups !== null ? (
						owned === null ? (
							<p>Wczytywanie…</p>
						) : groups.length === 0 ? (
							noMatch
						) : (
							<div class="org-groups">
								{groups.map((g) => {
									const collapsed = collapsedGroups.has(g.key);
									const ids = g.entries.map((e) => e.board.id);
									return (
										<section key={g.key} class="org-group">
											<div class="org-group-head">
												<button
													type="button"
													class="org-group-toggle"
													aria-expanded={!collapsed}
													onClick={() => toggleCollapseGroup(g.key)}
												>
													<Icon
														name={collapsed ? "chevron-right" : "chevron-down"}
													/>
													<ColorDot color={g.color} />
													<span class="org-group-title">{g.title}</span>
													<span class="org-count">{g.entries.length}</span>
												</button>
												{g.key.startsWith("owner:") &&
													g.key !== "owner:mine" &&
													g.title.toLowerCase() !==
														account.username.toLowerCase() && (
														<span class="row org-group-actions">
															{savedFriendNames.has(g.title.toLowerCase()) ? (
																<button
																	type="button"
																	class="org-group-friend-badge"
																	title={`Osoba „${g.title}” jest w znajomych`}
																	onClick={(e) => {
																		const r =
																			e.currentTarget.getBoundingClientRect();
																		setPersonPopover({
																			username: g.title,
																			x: r.left,
																			y: r.bottom + 6,
																		});
																	}}
																>
																	<Icon name="user-check" />
																	<span>Znajomy</span>
																</button>
															) : (
																<button
																	type="button"
																	class="org-owner-save"
																	aria-label={`Dodaj ${g.title} do znajomych`}
																	onClick={() => void addFriendQuick(g.title)}
																>
																	<Icon name="user-plus" />
																	<span>Dodaj do znajomych</span>
																</button>
															)}
														</span>
													)}
												{g.folderId && (
													<span class="row org-group-actions">
														<button
															type="button"
															class="icon-btn"
															aria-label={`Nowa tablica w folderze ${g.title}`}
															title="Nowa tablica w tym folderze"
															onClick={() => {
																patch({
																	folder: g.folderId,
																	pinnedOnly: false,
																});
																setTimeout(
																	() => createInputRef.current?.focus(),
																	0,
																);
															}}
														>
															<Icon name="plus" />
														</button>
														<button
															type="button"
															class="icon-btn"
															aria-label={`Edytuj folder ${g.title}`}
															title="Edytuj folder"
															onClick={() => {
																const f = folderMap.get(g.folderId ?? "");
																if (f)
																	setFolderDialog({ open: true, folder: f });
															}}
														>
															<Icon name="pen" />
														</button>
													</span>
												)}
											</div>
											{!collapsed &&
												(g.entries.length === 0 ? (
													<p class="muted org-empty-group">
														Folder jest pusty — przeciągnij tu tablicę albo
														przypisz ją z menu karty „Organizuj…”.
													</p>
												) : (
													<ul
														class={`boards${view === "tiles" ? " tiles" : ""}`}
													>
														{g.entries.map((e, idx) =>
															renderBoardRow(e.board, e.mine, ids, idx),
														)}
													</ul>
												))}
										</section>
									);
								})}
							</div>
						)
					) : (
						<>
							{owned === null ? (
								<>
									<h2>Moje tablice</h2>
									<p>Wczytywanie…</p>
								</>
							) : (isFiltering(filter) || isScopedNav) &&
								ownedShown.length === 0 &&
								visitedShown.length === 0 ? (
								<>
									{isScopedNav && (
										<div class="section-head">
											<h2>
												{activeFolderObj
													? activeFolderObj.name
													: filter.folder === "unfiled"
														? "Bez folderu"
														: "Przypięte tablice"}
											</h2>
											{activeFolderObj && (
												<button
													type="button"
													class="icon-btn"
													aria-label={`Edytuj folder ${activeFolderObj.name}`}
													title="Edytuj folder"
													onClick={() =>
														setFolderDialog({
															open: true,
															folder: activeFolderObj,
														})
													}
												>
													<Icon name="pen" />
												</button>
											)}
										</div>
									)}
									{noMatch}
								</>
							) : (
								<>
									{filter.scope !== "shared" &&
										(!(isFiltering(filter) || isScopedNav) ||
											ownedShown.length > 0) && (
											<>
												<div class="section-head">
													<h2>
														{activeFolderObj
															? activeFolderObj.name
															: filter.folder === "unfiled"
																? "Bez folderu"
																: filter.pinnedOnly
																	? "Przypięte tablice"
																	: "Moje tablice"}
													</h2>
													{activeFolderObj && (
														<button
															type="button"
															class="icon-btn"
															aria-label={`Edytuj folder ${activeFolderObj.name}`}
															title="Edytuj folder"
															onClick={() =>
																setFolderDialog({
																	open: true,
																	folder: activeFolderObj,
																})
															}
														>
															<Icon name="pen" />
														</button>
													)}
												</div>
												{owned.length === 0 && !activeFolderObj ? (
													<p class="muted">Nie masz jeszcze tablic.</p>
												) : (
													<ul
														class={`boards${view === "tiles" ? " tiles" : ""}`}
													>
														{ownedShown.map((b, idx) =>
															renderBoardRow(b, true, ownedShownIds, idx),
														)}
													</ul>
												)}
											</>
										)}

									{visited.length > 0 &&
										filter.scope !== "mine" &&
										(!(isFiltering(filter) || isScopedNav) ||
											visitedShown.length > 0) && (
											<>
												<h2>Tablice, do których mam dostęp</h2>
												<ul class={`boards${view === "tiles" ? " tiles" : ""}`}>
													{visitedShown.map((b, idx) =>
														renderBoardRow(b, false, visitedShownIds, idx),
													)}
												</ul>
											</>
										)}
								</>
							)}
						</>
					)}
				</div>
			</div>

			{/* Bulk selection Floating Island */}
			{selectMode && selectedBoardsList.length > 0 && (
				<section class="bulk-island" aria-label="Akcje dla zaznaczonych tablic">
					<span class="bulk-count" aria-live="polite">
						Zaznaczono: {selectedBoardsList.length}
					</span>
					<button
						type="button"
						onClick={() =>
							setSelectedIds(
								allVisibleSelected ? new Set() : new Set(allVisibleIds),
							)
						}
					>
						{allVisibleSelected ? "Odznacz wszystko" : "Zaznacz wszystko"}
					</button>
					<button
						type="button"
						onClick={() => setOrganizeBoards(selectedBoardsList)}
					>
						Organizuj…
					</button>
					{selectedOwnedCount > 0 && (
						<button type="button" onClick={() => setBulkTransferOpen(true)}>
							Przekaż…
						</button>
					)}
					<button type="button" onClick={() => void bulkPin(true)}>
						Przypnij
					</button>
					<button type="button" onClick={() => void bulkPin(false)}>
						Odepnij
					</button>
					{selectedOwnedCount > 0 &&
						(bulkConfirmDelete ? (
							<button
								type="button"
								class="danger"
								onClick={() => void bulkDeleteOwned()}
							>
								Na pewno usunąć ({selectedOwnedCount})?
							</button>
						) : (
							<button
								type="button"
								class="danger-outline"
								onClick={() => setBulkConfirmDelete(true)}
							>
								Usuń
							</button>
						))}
					<button
						type="button"
						onClick={() => {
							setSelectedIds(new Set());
							setSelectMode(false);
							setBulkConfirmDelete(false);
						}}
					>
						Anuluj
					</button>
				</section>
			)}

			{toast && (
				<div
					class={`panel-toast${toast.tone === "error" ? " panel-toast-error" : ""}`}
					role={toast.tone === "error" ? "alert" : "status"}
					aria-live="polite"
				>
					<span>{toast.message}</span>
					{toast.onUndo && (
						<button
							type="button"
							class="toast-undo"
							onClick={() => {
								const fn = toast.onUndo;
								setToast(null);
								void fn?.();
							}}
						>
							{toast.undoLabel ?? "Cofnij"}
						</button>
					)}
					<button
						type="button"
						class="toast-close"
						aria-label="Zamknij powiadomienie"
						onClick={() => setToast(null)}
					>
						<Icon name="close" />
					</button>
				</div>
			)}
		</main>
	);
}

interface RowProps {
	board: BoardSummary;
	mine: boolean;
	/** Draw the row as a tile with a picture of the board (R-052). */
	tiles?: boolean;
	folder?: BoardFolder;
	markers: BoardMarker[];
	navigate: (to: string) => void;
	selectMode?: boolean;
	selected?: boolean;
	onToggleSelect?: (shiftKey: boolean) => void;
	onTogglePin?: () => void;
	onOrganize?: () => void;
	onManageOwners?: () => void;
	currentUsername?: string;
	savedFriendNames?: Set<string>;
	onOpenPerson?: (username: string, at: { x: number; y: number }) => void;
	onQuickAddFriend?: (username: string) => void;
	onNotify?: (message: string) => void;
	customOrder?: boolean;
	canMoveUp?: boolean;
	canMoveDown?: boolean;
	onMoveUp?: () => void;
	onMoveDown?: () => void;
	dragging?: boolean;
	onDragStart?: () => void;
	onDragEnd?: () => void;
	onDropOnBoard?: (sourceId: string) => void;
	onRenamed?: (name: string) => void;
	onDeleted?: () => void;
	onForgotten?: () => void;
	onCopied?: (copy: { id: string; name: string }) => void;
}

function BoardRow({
	board,
	mine,
	tiles,
	folder,
	markers,
	navigate,
	selectMode,
	selected,
	onToggleSelect,
	onTogglePin,
	onOrganize,
	onManageOwners,
	currentUsername,
	savedFriendNames,
	onOpenPerson,
	onQuickAddFriend,
	onNotify,
	customOrder,
	canMoveUp,
	canMoveDown,
	onMoveUp,
	onMoveDown,
	dragging,
	onDragStart,
	onDragEnd,
	onDropOnBoard,
	onRenamed,
	onDeleted,
	onCopied,
	onForgotten,
}: RowProps) {
	const [renaming, setRenaming] = useState(false);
	const [renameValue, setRenameValue] = useState(board.name);
	const [menuOpen, setMenuOpen] = useState(false);
	const [confirming, setConfirming] = useState(false);
	const [busy, setBusy] = useState(false);
	const [dropOver, setDropOver] = useState(false);
	const [error, setError] = useState("");
	const renameInputRef = useRef<HTMLInputElement>(null);
	const menuWrapRef = useRef<HTMLDivElement>(null);
	const titleClickTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
	const link = `${location.origin}/b/${board.id}`;

	useEffect(() => () => clearTimeout(titleClickTimer.current), []);

	useLayoutEffect(() => {
		if (!renaming) return;
		setRenameValue(board.name);
		setError("");
		renameInputRef.current?.focus();
		renameInputRef.current?.select();
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.preventDefault();
				setRenaming(false);
				setError("");
			}
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [renaming, board.name]);

	useEffect(() => {
		if (!menuOpen) return;
		const onDown = (e: MouseEvent) => {
			if (!menuWrapRef.current?.contains(e.target as Node)) {
				setMenuOpen(false);
				setConfirming(false);
			}
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				setMenuOpen(false);
				setConfirming(false);
			}
		};
		document.addEventListener("mousedown", onDown);
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("mousedown", onDown);
			document.removeEventListener("keydown", onKey);
		};
	}, [menuOpen]);

	const rename = async () => {
		const name = renameValue.trim();
		if (!name) {
			setError("Podaj nazwę tablicy.");
			renameInputRef.current?.focus();
			return;
		}
		if (busy) return;
		setBusy(true);
		setError("");
		try {
			await api.renameBoard(board.id, name);
			onRenamed?.(name);
			setRenaming(false);
		} catch (e) {
			setError(api.errorMessage(e));
		} finally {
			setBusy(false);
		}
	};

	const copy = async () => {
		if (busy) return;
		setBusy(true);
		setMenuOpen(false);
		try {
			onCopied?.(await api.copyBoard(board.id));
		} catch (e) {
			setError(api.errorMessage(e));
		} finally {
			setBusy(false);
		}
	};

	const forget = async () => {
		if (busy) return;
		setBusy(true);
		setMenuOpen(false);
		try {
			await api.forgetBoard(board.id);
			onForgotten?.();
		} catch (e) {
			setError(api.errorMessage(e));
		} finally {
			setBusy(false);
		}
	};

	const remove = async () => {
		if (busy) return;
		setBusy(true);
		try {
			await api.deleteBoard(board.id);
			setMenuOpen(false);
			onDeleted?.();
		} catch (e) {
			setError(api.errorMessage(e));
			setConfirming(false);
		} finally {
			setBusy(false);
		}
	};

	const copyLink = async () => {
		setMenuOpen(false);
		try {
			await navigator.clipboard?.writeText(link);
			onNotify?.("Skopiowano link tablicy");
		} catch {
			onNotify?.("Nie udało się skopiować linku");
		}
	};

	const open = (e: MouseEvent) => {
		if (selectMode) {
			e.preventDefault();
			onToggleSelect?.(e.shiftKey);
			return;
		}
		if (e.defaultPrevented || e.button !== 0) return;
		if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
		e.preventDefault();
		navigate(`/b/${board.id}`);
	};

	const startDblClickRename = (e: MouseEvent) => {
		if (!mine || selectMode) return;
		clearTimeout(titleClickTimer.current);
		e.preventDefault();
		e.stopPropagation();
		setRenaming(true);
	};

	// Clicking an owned board's title waits briefly for a real mouse single-click (detail === 1)
	// so double-click can rename inline without accidentally navigating away.
	// Thumbnail clicks, keyboard Enter (detail === 0), modifier clicks, and shared boards open immediately.
	const openFromTitle = (e: MouseEvent) => {
		if (selectMode) {
			e.preventDefault();
			onToggleSelect?.(e.shiftKey);
			return;
		}
		if (e.defaultPrevented || e.button !== 0) return;
		if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
		e.preventDefault();
		if (mine && e.detail >= 2) {
			clearTimeout(titleClickTimer.current);
			setRenaming(true);
			return;
		}
		if (mine && e.detail === 1) {
			clearTimeout(titleClickTimer.current);
			titleClickTimer.current = setTimeout(() => {
				navigate(`/b/${board.id}`);
			}, 180);
			return;
		}
		navigate(`/b/${board.id}`);
	};

	const when = formatWhen(board.updatedAt);
	const hasTags = Boolean(folder) || markers.length > 0;
	const sizeText = formatSize(board.bytes);
	const otherCoOwners = mine
		? (board.owners ?? []).filter(
				(u) =>
					!currentUsername || u.toLowerCase() !== currentUsername.toLowerCase(),
			)
		: [];
	const sharedOwnersList =
		!mine && board.owner
			? (board.owners?.length ?? 0) > 1
				? (board.owners ?? [])
				: [board.owner]
			: [];
	const openPersonAt = (username: string, e: MouseEvent) => {
		e.preventDefault();
		e.stopPropagation();
		const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
		onOpenPerson?.(username, { x: r.left, y: r.bottom + 6 });
	};
	const renderSharedOwners = () =>
		sharedOwnersList.length > 0 && (
			<span class="muted owner">
				{"Tablica: "}
				{sharedOwnersList.map((u, i) => {
					const isSelf =
						!!currentUsername &&
						u.toLowerCase() === currentUsername.toLowerCase();
					const isFriend = Boolean(savedFriendNames?.has(u.toLowerCase()));
					return (
						<span key={u}>
							{i > 0 ? ", " : ""}
							{isSelf || !onOpenPerson ? (
								u
							) : (
								<button
									type="button"
									class={`board-person-btn${isFriend ? " is-friend" : ""}`}
									title={
										isFriend
											? `${u} (w znajomych) — kliknij po opcje`
											: `Kliknij, aby dodać „${u}” do znajomych`
									}
									onClick={(e) => openPersonAt(u, e)}
								>
									{u}
								</button>
							)}
						</span>
					);
				})}
			</span>
		);
	const renderCoOwners = () =>
		otherCoOwners.length > 0 && (
			<span
				class="muted owner coowners"
				title={`Współwłaściciele: ${board.owners?.join(", ")}`}
			>
				<Icon name="users" />
				{otherCoOwners.map((u, i) => {
					const isFriend = Boolean(savedFriendNames?.has(u.toLowerCase()));
					return (
						<span key={u}>
							{i > 0 ? ", " : ""}
							{onOpenPerson ? (
								<button
									type="button"
									class={`board-person-btn${isFriend ? " is-friend" : ""}`}
									title={
										isFriend
											? `${u} (w znajomych) — kliknij po opcje`
											: `Kliknij, aby dodać „${u}” do znajomych`
									}
									onClick={(e) => openPersonAt(u, e)}
								>
									{u}
								</button>
							) : (
								<span>{u}</span>
							)}
						</span>
					);
				})}
			</span>
		);
	const movePrevIcon: IconName = tiles ? "arrow-left" : "arrow-up";
	const moveNextIcon: IconName = tiles ? "arrow-right" : "arrow-down";
	const movePrevLabel = tiles ? "Przesuń w lewo" : "Przesuń wyżej";
	const moveNextLabel = tiles ? "Przesuń w prawo" : "Przesuń niżej";

	const titleNode = (
		// biome-ignore lint/a11y/noStaticElementInteractions: title text delegates navigation to <a.open-link> and supports mouse double-click rename (keyboard/touch use the overflow menu).
		// biome-ignore lint/a11y/useKeyWithClickEvents: keyboard users open via <a.open-link> and rename via the overflow menu.
		<span
			class={`name${mine && !selectMode ? " name-editable" : ""}`}
			title={
				tiles && mine && !selectMode
					? "Kliknij dwukrotnie, aby zmienić nazwę"
					: undefined
			}
			onClick={tiles && mine && !selectMode ? openFromTitle : undefined}
			onDblClick={startDblClickRename}
		>
			{tiles ? (
				board.name
			) : (
				<a class="open-link" href={`/b/${board.id}`} onClick={openFromTitle}>
					{board.name}
				</a>
			)}
			{mine && !selectMode && (
				// biome-ignore lint/a11y/noStaticElementInteractions: visual hover micro-cue; keyboard and touch users use "Więcej akcji -> Zmień nazwę".
				// biome-ignore lint/a11y/useKeyWithClickEvents: keyboard users rename via "Więcej akcji -> Zmień nazwę".
				<span
					class="rename-cue"
					title="Zmień nazwę"
					aria-hidden="true"
					onClick={(e) => {
						clearTimeout(titleClickTimer.current);
						e.preventDefault();
						e.stopPropagation();
						setRenaming(true);
					}}
				>
					<Icon name="pen" />
				</span>
			)}
		</span>
	);

	const renameForm = (
		<form
			class="rename-form"
			onSubmit={(e) => {
				e.preventDefault();
				void rename();
			}}
		>
			<input
				ref={renameInputRef}
				name="rename"
				aria-label="Nowa nazwa tablicy"
				autoComplete="off"
				maxLength={100}
				value={renameValue}
				onInput={(e) => {
					setRenameValue(e.currentTarget.value);
					if (error) setError("");
				}}
				onKeyDown={(e) => {
					if (e.key === "Escape") {
						e.preventDefault();
						setRenaming(false);
						setError("");
					}
				}}
			/>
			<button
				type="submit"
				class="rename-icon-btn primary"
				aria-label="Zapisz"
				title="Zapisz nazwę (Enter)"
				disabled={busy}
			>
				<Icon name="check" />
			</button>
			<button
				type="button"
				class="rename-icon-btn"
				aria-label="Anuluj"
				title="Anuluj (Esc)"
				onClick={() => {
					setRenaming(false);
					setError("");
				}}
				disabled={busy}
			>
				<Icon name="close" />
			</button>
		</form>
	);

	const quietControls = !selectMode && !renaming && (
		<div class="board-controls" ref={menuWrapRef}>
			{customOrder && canMoveUp && (
				<button
					type="button"
					class="card-quiet-btn"
					aria-label={movePrevLabel}
					title={movePrevLabel}
					onClick={() => onMoveUp?.()}
				>
					<Icon name={movePrevIcon} />
				</button>
			)}
			{customOrder && canMoveDown && (
				<button
					type="button"
					class="card-quiet-btn"
					aria-label={moveNextLabel}
					title={moveNextLabel}
					onClick={() => onMoveDown?.()}
				>
					<Icon name={moveNextIcon} />
				</button>
			)}
			<button
				type="button"
				class={`card-quiet-btn card-pin-btn${board.pinned ? " is-pinned" : ""}`}
				aria-label={board.pinned ? "Odepnij" : "Przypnij"}
				title={board.pinned ? "Odepnij" : "Przypnij"}
				aria-pressed={Boolean(board.pinned)}
				onClick={() => onTogglePin?.()}
			>
				<Icon name="pin" />
			</button>
			<div class="card-more-wrap">
				<button
					type="button"
					class="card-quiet-btn"
					aria-label="Więcej akcji"
					title="Więcej akcji"
					aria-expanded={menuOpen}
					aria-haspopup="menu"
					onClick={() => {
						setMenuOpen(!menuOpen);
						setConfirming(false);
					}}
				>
					<Icon name="more" />
				</button>
				{menuOpen && (
					<div class="action-popover card-popover" role="menu">
						<button
							type="button"
							role="menuitem"
							onClick={() => void copyLink()}
						>
							<Icon name="link" />
							Kopiuj link
						</button>
						<button
							type="button"
							role="menuitem"
							onClick={() => {
								setMenuOpen(false);
								onOrganize?.();
							}}
						>
							<Icon name="folder" />
							Organizuj…
						</button>
						{mine && onManageOwners && (
							<button
								type="button"
								role="menuitem"
								onClick={() => {
									setMenuOpen(false);
									onManageOwners();
								}}
							>
								<Icon name="users" />
								Właściciele…
							</button>
						)}
						{!mine &&
							board.owner &&
							onQuickAddFriend &&
							!savedFriendNames?.has(board.owner.toLowerCase()) && (
								<button
									type="button"
									role="menuitem"
									onClick={() => {
										setMenuOpen(false);
										if (board.owner) onQuickAddFriend(board.owner);
									}}
								>
									<Icon name="user-plus" />
									Dodaj „{board.owner}” do znajomych
								</button>
							)}
						<button
							type="button"
							role="menuitem"
							onClick={() => {
								setMenuOpen(false);
								onTogglePin?.();
							}}
						>
							<Icon name="pin" />
							{board.pinned ? "Odepnij" : "Przypnij na górze"}
						</button>
						{mine && (
							<button
								type="button"
								role="menuitem"
								onClick={() => {
									setMenuOpen(false);
									setRenaming(true);
								}}
							>
								<Icon name="pen" />
								Zmień nazwę
							</button>
						)}
						{mine && (
							<button type="button" role="menuitem" onClick={() => void copy()}>
								<Icon name="copy" />
								Utwórz kopię
							</button>
						)}
						<hr class="popover-sep" />
						{!mine ? (
							<button
								type="button"
								role="menuitem"
								class="popover-danger"
								onClick={() => void forget()}
							>
								<Icon name="close" />
								Usuń z listy
							</button>
						) : confirming ? (
							<div class="popover-confirm">
								<span class="muted org-hint">Usunąć tablicę na zawsze?</span>
								<div class="row">
									<button
										type="button"
										onClick={() => setConfirming(false)}
										disabled={busy}
									>
										Anuluj
									</button>
									<button
										type="button"
										class="danger"
										disabled={busy}
										onClick={() => void remove()}
									>
										Na pewno usunąć?
									</button>
								</div>
							</div>
						) : (
							<button
								type="button"
								role="menuitem"
								class="popover-danger"
								onClick={() => setConfirming(true)}
							>
								<Icon name="trash" />
								Usuń
							</button>
						)}
					</div>
				)}
			</div>
		</div>
	);

	return (
		<li
			class={`board${selected ? " board-selected" : ""}${dragging ? " board-dragging" : ""}${dropOver ? " board-drop-over" : ""}${menuOpen ? " board-menu-open" : ""}${renaming ? " board-renaming" : ""}`}
			draggable={!renaming && !selectMode}
			onDragStart={(e) => {
				e.dataTransfer?.setData("text/plain", board.id);
				if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
				onDragStart?.();
			}}
			onDragEnd={() => {
				setDropOver(false);
				onDragEnd?.();
			}}
			onDragOver={(e) => {
				if (!customOrder) return;
				e.preventDefault();
				setDropOver(true);
			}}
			onDragLeave={() => setDropOver(false)}
			onDrop={(e) => {
				if (!customOrder) return;
				e.preventDefault();
				setDropOver(false);
				const sourceId = e.dataTransfer?.getData("text/plain");
				if (sourceId) onDropOnBoard?.(sourceId);
			}}
		>
			{selectMode && (
				<button
					type="button"
					class="board-select-btn"
					aria-label={
						selected ? `Odznacz ${board.name}` : `Zaznacz ${board.name}`
					}
					aria-pressed={selected}
					onClick={(e) => onToggleSelect?.(e.shiftKey)}
				>
					{selected ? <Icon name="check" /> : null}
				</button>
			)}

			{tiles ? (
				<>
					<a
						class="open-link"
						href={`/b/${board.id}`}
						onClick={open}
						aria-label={board.name}
					>
						<BoardPreview boardId={board.id} mine={mine} />
					</a>
					{renaming ? (
						renameForm
					) : (
						<div class="board-head">
							{titleNode}
							{quietControls}
						</div>
					)}
					{hasTags && (
						<div class="board-tags">
							{folder && (
								<span class="board-tag board-tag-folder" title={folder.name}>
									<ColorDot color={folder.color} />
									{!folder.color && <Icon name="folder" />}
									<span class="board-tag-text">{folder.name}</span>
								</span>
							)}
							{markers.map((m) => (
								<span key={m.id} class="board-tag" title={m.name}>
									<ColorDot color={m.color} />
									<span class="board-tag-text">{m.name}</span>
								</span>
							))}
						</div>
					)}
					<div class="board-foot">
						{renderSharedOwners()}
						{renderCoOwners()}
						<div class="board-meta-line">
							<time class="when muted" dateTime={board.updatedAt}>
								<span class="date">{when.date}</span>
								<span class="sep" aria-hidden="true">
									{" "}
									·{" "}
								</span>
								<span class="time">{when.time}</span>
							</time>
							{sizeText && (
								<>
									<span class="muted sep" aria-hidden="true">
										·
									</span>
									<span class="size muted">{sizeText}</span>
								</>
							)}
						</div>
					</div>
				</>
			) : (
				<>
					<div class="board-list-main">
						{renaming ? renameForm : titleNode}
						{!renaming && hasTags && (
							<div class="board-tags">
								{folder && (
									<span class="board-tag board-tag-folder" title={folder.name}>
										<ColorDot color={folder.color} />
										{!folder.color && <Icon name="folder" />}
										<span class="board-tag-text">{folder.name}</span>
									</span>
								)}
								{markers.map((m) => (
									<span key={m.id} class="board-tag" title={m.name}>
										<ColorDot color={m.color} />
										<span class="board-tag-text">{m.name}</span>
									</span>
								))}
							</div>
						)}
					</div>
					{!renaming && (
						<div class="board-list-right">
							{renderSharedOwners()}
							{renderCoOwners()}
							<time class="when muted" dateTime={board.updatedAt}>
								<span class="date">{when.date}</span>
								<span class="sep" aria-hidden="true">
									{" "}
									·{" "}
								</span>
								<span class="time">{when.time}</span>
							</time>
							{sizeText && <span class="size muted">{sizeText}</span>}
							{quietControls}
						</div>
					)}
				</>
			)}

			{error && (
				<span class="error" role="alert">
					{error}
				</span>
			)}
		</li>
	);
}

/** The date and the hour of a change, apart and without seconds ("11.11.2026" and "14:18"). */
function formatWhen(iso: string): { date: string; time: string } {
	const d = new Date(iso);
	return {
		date: d.toLocaleDateString("pl-PL", {
			day: "2-digit",
			month: "2-digit",
			year: "numeric",
		}),
		time: d.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" }),
	};
}
