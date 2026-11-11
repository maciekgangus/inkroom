import { useEffect, useRef, useState } from "preact/hooks";
import type { BoardSummary } from "./api";
import * as api from "./api";
import { BoardPreview } from "./board-preview";
import { Icon, type IconName } from "./icon";
import { Logo } from "./logo";

const VIEW_KEY = "inkroom.boardView";
type View = "list" | "tiles";

const storedView = (): View => {
	try {
		return localStorage.getItem(VIEW_KEY) === "tiles" ? "tiles" : "list";
	} catch {
		return "list";
	}
};

interface Props {
	username: string;
	navigate: (to: string) => void;
	onLogout: () => void;
}

/** The logged-in user's home: own boards, boards they were invited to, and creating new ones. */
export function Panel({ username, navigate, onLogout }: Props) {
	const [owned, setOwned] = useState<BoardSummary[] | null>(null);
	const [visited, setVisited] = useState<BoardSummary[]>([]);
	const [error, setError] = useState("");
	const [view, setViewState] = useState<View>(storedView);
	const setView = (v: View) => {
		setViewState(v);
		try {
			localStorage.setItem(VIEW_KEY, v);
		} catch {
			// The choice is just not remembered.
		}
	};

	const loading = useRef(false);
	// Reads both lists from the server. `quiet` (a refresh) keeps what is shown when it fails.
	const load = (quiet: boolean) => {
		if (loading.current) return; // a read is on its way: it will bring the latest
		loading.current = true;
		api
			.listBoards()
			.then((l) => {
				setOwned(l.owned);
				setVisited(l.visited);
			})
			.catch((e) => {
				if (!quiet) setError(e.message);
			})
			.finally(() => {
				loading.current = false;
			});
	};

	useEffect(() => {
		load(false);
		// The panel shows what the server had when it was opened, and people come back to it
		// after drawing elsewhere: by "back" (the page may be restored from the browser's
		// back-forward cache, scripts and all, without loading), from another tab or window.
		const refresh = () => load(true);
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

	const create = async (form: HTMLFormElement) => {
		const name = String(new FormData(form).get("name") ?? "").trim();
		setError("");
		try {
			const b = await api.createBoard(name);
			navigate(`/b/${b.id}`);
		} catch (e) {
			setError(e instanceof Error ? e.message : "Błąd");
		}
	};

	const logout = async () => {
		await api.logout().catch(() => {});
		onLogout();
	};

	return (
		<main class="panel">
			<header class="row between">
				<h1 class="brand">
					<Logo />
				</h1>
				<span class="row">
					<span class="chip">{username}</span>
					<button type="button" onClick={logout}>
						Wyloguj
					</button>
				</span>
			</header>
			{error && (
				<p class="error" role="alert">
					{error}
				</p>
			)}

			<h2>Nowa tablica</h2>
			<form
				class="row"
				onSubmit={(e) => {
					e.preventDefault();
					create(e.currentTarget as HTMLFormElement);
				}}
			>
				<input name="name" placeholder="Nazwa tablicy" maxLength={100} />
				<button type="submit" class="primary">
					Utwórz tablicę
				</button>
			</form>

			<fieldset class="view-switch" aria-label="Widok tablic">
				<button
					type="button"
					class="icon-btn"
					aria-label="Lista"
					title="Lista"
					aria-pressed={view === "list"}
					onClick={() => setView("list")}
				>
					<Icon name="lines" />
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
			<h2>Moje tablice</h2>
			{owned === null ? (
				<p>Wczytywanie…</p>
			) : owned.length === 0 ? (
				<p class="muted">Nie masz jeszcze tablic.</p>
			) : (
				<ul class={`boards${view === "tiles" ? " tiles" : ""}`}>
					{owned.map((b) => (
						<BoardRow
							key={b.id}
							board={b}
							mine
							tiles={view === "tiles"}
							navigate={navigate}
							onRenamed={(name) =>
								setOwned(owned.map((x) => (x.id === b.id ? { ...x, name } : x)))
							}
							onDeleted={() => setOwned(owned.filter((x) => x.id !== b.id))}
							onCopied={(copy) =>
								setOwned([
									{ ...copy, updatedAt: new Date().toISOString() },
									...owned,
								])
							}
						/>
					))}
				</ul>
			)}

			{visited.length > 0 && (
				<>
					<h2>Tablice, do których mam dostęp</h2>
					<ul class={`boards${view === "tiles" ? " tiles" : ""}`}>
						{visited.map((b) => (
							<BoardRow
								key={b.id}
								board={b}
								mine={false}
								tiles={view === "tiles"}
								navigate={navigate}
								onForgotten={() =>
									setVisited(visited.filter((x) => x.id !== b.id))
								}
							/>
						))}
					</ul>
				</>
			)}
		</main>
	);
}

interface RowProps {
	board: BoardSummary;
	mine: boolean;
	/** Draw the row as a tile with a picture of the board (R-052). */
	tiles?: boolean;
	navigate: (to: string) => void;
	onRenamed?: (name: string) => void;
	onDeleted?: () => void;
	/** Called after a joined board was dropped from the list (R-051). */
	onForgotten?: () => void;
	/** Called with the new board after the owner made a copy (R-020). */
	onCopied?: (copy: { id: string; name: string }) => void;
}

function BoardRow({
	board,
	mine,
	tiles,
	navigate,
	onRenamed,
	onDeleted,
	onCopied,
	onForgotten,
}: RowProps) {
	const [renaming, setRenaming] = useState(false);
	const [confirming, setConfirming] = useState(false);
	const [error, setError] = useState("");
	const link = `${location.origin}/b/${board.id}`;

	const rename = async (form: HTMLFormElement) => {
		const name = String(new FormData(form).get("rename") ?? "").trim();
		if (!name) return;
		try {
			await api.renameBoard(board.id, name);
			onRenamed?.(name);
			setRenaming(false);
		} catch (e) {
			setError(e instanceof Error ? e.message : "Błąd");
		}
	};

	const copy = async () => {
		try {
			onCopied?.(await api.copyBoard(board.id));
		} catch (e) {
			setError(e instanceof Error ? e.message : "Błąd");
		}
	};

	const forget = async () => {
		try {
			await api.forgetBoard(board.id);
			onForgotten?.();
		} catch (e) {
			setError(e instanceof Error ? e.message : "Błąd");
		}
	};

	const remove = async () => {
		try {
			await api.deleteBoard(board.id);
			onDeleted?.();
		} catch (e) {
			setError(e instanceof Error ? e.message : "Błąd");
			setConfirming(false);
		}
	};

	// One action of the row: an icon with the word as its label and its tooltip.
	const action = (label: string, icon: IconName, onClick: () => void) => (
		<button
			type="button"
			class="icon-btn"
			aria-label={label}
			title={label}
			onClick={onClick}
		>
			<Icon name={icon} />
		</button>
	);

	const open = (e: MouseEvent) => {
		// A click with a modifier (or another button) is the browser's: a new tab, a menu.
		if (e.defaultPrevented || e.button !== 0) return;
		if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
		e.preventDefault();
		navigate(`/b/${board.id}`);
	};
	// The link is stretched over the whole row or tile (see .open-link), so anywhere on it opens
	// the board; the buttons and the rename field stay above it.
	const nameNode = (
		<span class="name">
			{tiles ? (
				board.name
			) : (
				<a class="open-link" href={`/b/${board.id}`} onClick={open}>
					{board.name}
				</a>
			)}
		</span>
	);
	const when = formatWhen(board.updatedAt);

	return (
		<li class="board">
			{tiles && (
				// The picture and the name are one link: the whole tile opens the board.
				<a class="open-link" href={`/b/${board.id}`} onClick={open}>
					<BoardPreview boardId={board.id} />
					{!renaming && nameNode}
				</a>
			)}
			{renaming ? (
				<form
					class="row"
					onSubmit={(e) => {
						e.preventDefault();
						rename(e.currentTarget as HTMLFormElement);
					}}
				>
					<input name="rename" defaultValue={board.name} maxLength={100} />
					<button type="submit">Zapisz</button>
				</form>
			) : (
				!tiles && nameNode
			)}
			{!mine && board.owner && (
				<span class="muted owner">Tablica: {board.owner}</span>
			)}
			<time class="when muted" dateTime={board.updatedAt}>
				<span class="date">{when.date}</span>
				<span class="sep"> · </span>
				<span class="time">{when.time}</span>
			</time>
			<span class="row actions">
				{action("Kopiuj link", "link", () =>
					navigator.clipboard?.writeText(link),
				)}
				{mine && action("Utwórz kopię", "copy", copy)}
				{mine &&
					!renaming &&
					action("Zmień nazwę", "pen", () => setRenaming(true))}
				{!mine && action("Usuń z listy", "close", forget)}
				{mine &&
					(confirming ? (
						<button type="button" class="danger" onClick={remove}>
							Na pewno usunąć?
						</button>
					) : (
						action("Usuń", "trash", () => setConfirming(true))
					))}
			</span>
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
