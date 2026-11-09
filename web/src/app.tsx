import { useMemo, useState } from "preact/hooks";
import { BoardView, newId } from "./board-view";
import type { SocketLike } from "./sync/sync";

const BOARD_PATH = /^\/b\/([0-9a-f]{32})$/;
const NAME_KEY = "inkroom.name";
const AUTHOR_KEY = "inkroom.authorId";

interface Props {
	path?: string;
	navigate?: (to: string) => void;
	createSocket?: (url: string) => SocketLike;
}

const realSocket = (url: string) => new WebSocket(url) as unknown as SocketLike;
const goTo = (to: string) => location.assign(to);

/** Reads a value from storage; storage can be unavailable (private mode), so never throw. */
function stored(storage: Storage, key: string): string | null {
	try {
		return storage.getItem(key);
	} catch {
		return null;
	}
}

function store(storage: Storage, key: string, value: string): void {
	try {
		storage.setItem(key, value);
	} catch {
		// Not remembering is fine.
	}
}

/** Root component: home page, or a board page at /b/<id>. */
export function App({
	path = location.pathname,
	navigate = goTo,
	createSocket = realSocket,
}: Props) {
	const match = BOARD_PATH.exec(path);
	if (!match) return <Home navigate={navigate} />;
	return <BoardPage id={match[1]} createSocket={createSocket} />;
}

function Home({ navigate }: { navigate: (to: string) => void }) {
	const [busy, setBusy] = useState(false);
	const create = async () => {
		setBusy(true);
		try {
			const res = await fetch("/api/boards", { method: "POST" });
			if (!res.ok) throw new Error(String(res.status));
			const { id } = await res.json();
			navigate(`/b/${id}`);
		} catch {
			setBusy(false);
		}
	};
	return (
		<main class="center">
			<h1>Inkroom</h1>
			<button type="button" class="primary" disabled={busy} onClick={create}>
				Nowa tablica
			</button>
		</main>
	);
}

function BoardPage({
	id,
	createSocket,
}: {
	id: string;
	createSocket: (url: string) => SocketLike;
}) {
	const [name, setName] = useState(() => stored(localStorage, NAME_KEY));
	const authorId = useMemo(() => {
		const existing = stored(sessionStorage, AUTHOR_KEY);
		if (existing) return existing;
		const fresh = newId();
		store(sessionStorage, AUTHOR_KEY, fresh);
		return fresh;
	}, []);
	const connect = useMemo(() => {
		const scheme = location.protocol === "https:" ? "wss" : "ws";
		const url = `${scheme}://${location.host}/ws/${id}?name=${encodeURIComponent(name ?? "")}`;
		return () => createSocket(url);
	}, [id, name, createSocket]);

	if (!name) {
		return (
			<NamePrompt
				onSubmit={(n) => {
					store(localStorage, NAME_KEY, n);
					setName(n);
				}}
			/>
		);
	}
	return <BoardView authorId={authorId} connect={connect} />;
}

function NamePrompt({ onSubmit }: { onSubmit: (name: string) => void }) {
	return (
		<main class="center">
			<form
				onSubmit={(e) => {
					e.preventDefault();
					const name = String(
						new FormData(e.currentTarget as HTMLFormElement).get("name") ?? "",
					).trim();
					if (name) onSubmit(name);
				}}
			>
				<h1>Jak masz na imię?</h1>
				<input name="name" placeholder="Imię" maxLength={40} />{" "}
				<button type="submit" class="primary">
					Wejdź
				</button>
			</form>
		</main>
	);
}
