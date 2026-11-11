import { useEffect, useState } from "preact/hooks";
import type { BoardSummary } from "./api";
import * as api from "./api";

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

	useEffect(() => {
		api
			.listBoards()
			.then((l) => {
				setOwned(l.owned);
				setVisited(l.visited);
			})
			.catch((e) => setError(e.message));
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
				<h1 class="brand">Inkroom</h1>
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

			<h2>Moje tablice</h2>
			{owned === null ? (
				<p>Wczytywanie…</p>
			) : owned.length === 0 ? (
				<p class="muted">Nie masz jeszcze tablic.</p>
			) : (
				<ul class="boards">
					{owned.map((b) => (
						<BoardRow
							key={b.id}
							board={b}
							mine
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
					<ul class="boards">
						{visited.map((b) => (
							<BoardRow key={b.id} board={b} mine={false} navigate={navigate} />
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
	navigate: (to: string) => void;
	onRenamed?: (name: string) => void;
	onDeleted?: () => void;
	/** Called with the new board after the owner made a copy (R-020). */
	onCopied?: (copy: { id: string; name: string }) => void;
}

function BoardRow({
	board,
	mine,
	navigate,
	onRenamed,
	onDeleted,
	onCopied,
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

	const remove = async () => {
		try {
			await api.deleteBoard(board.id);
			onDeleted?.();
		} catch (e) {
			setError(e instanceof Error ? e.message : "Błąd");
			setConfirming(false);
		}
	};

	return (
		<li class="board">
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
				<span class="name">{board.name}</span>
			)}
			<span class="muted">
				{new Date(board.updatedAt).toLocaleString("pl-PL")}
			</span>
			<span class="row">
				<button type="button" onClick={() => navigate(`/b/${board.id}`)}>
					Otwórz
				</button>
				<button
					type="button"
					onClick={() => navigator.clipboard?.writeText(link)}
				>
					Kopiuj link
				</button>
				{mine && (
					<button type="button" onClick={copy}>
						Utwórz kopię
					</button>
				)}
				{mine && !renaming && (
					<button type="button" onClick={() => setRenaming(true)}>
						Zmień nazwę
					</button>
				)}
				{mine &&
					(confirming ? (
						<button type="button" class="danger" onClick={remove}>
							Na pewno usunąć?
						</button>
					) : (
						<button type="button" onClick={() => setConfirming(true)}>
							Usuń
						</button>
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
