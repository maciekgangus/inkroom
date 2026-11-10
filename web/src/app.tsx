import { useEffect, useMemo, useState } from "preact/hooks";
import * as api from "./api";
import { AuthForms } from "./auth-forms";
import { BoardView, newId } from "./board-view";
import { Panel } from "./panel";
import type { SocketLike } from "./sync/sync";
import { ThemeToggle } from "./theme";

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

/** Root component: home page (login or panel), or a board page at /b/<id>. */
export function App({
	path = location.pathname,
	navigate = goTo,
	createSocket = realSocket,
}: Props) {
	const match = BOARD_PATH.exec(path);
	return (
		<>
			{match ? (
				<BoardPage id={match[1]} createSocket={createSocket} />
			) : (
				<Home navigate={navigate} />
			)}
			<div class="corner">
				<ThemeToggle />
			</div>
		</>
	);
}

function Home({ navigate }: { navigate: (to: string) => void }) {
	const [email, setEmail] = useState<string | null | undefined>(undefined); // undefined: still asking the server
	useEffect(() => {
		api.me().then(setEmail, () => setEmail(null));
	}, []);

	if (email === undefined) return null;
	if (email === null) return <AuthForms onAuth={setEmail} />;
	return (
		<Panel email={email} navigate={navigate} onLogout={() => setEmail(null)} />
	);
}

function BoardPage({
	id,
	createSocket,
}: {
	id: string;
	createSocket: (url: string) => SocketLike;
}) {
	const [info, setInfo] = useState<{ owner: boolean } | null | undefined>(
		undefined,
	);
	const [account, setAccount] = useState<string | null | undefined>(undefined);
	const [guestName, setGuestName] = useState(() =>
		stored(localStorage, NAME_KEY),
	);
	useEffect(() => {
		api.boardInfo(id).then(setInfo);
		api.me().then(setAccount, () => setAccount(null));
	}, [id]);

	const authorId = useMemo(() => {
		const existing = stored(sessionStorage, AUTHOR_KEY);
		if (existing) return existing;
		const fresh = newId();
		store(sessionStorage, AUTHOR_KEY, fresh);
		return fresh;
	}, []);

	// Logged-in users are known by their e-mail's local part; guests give a name.
	const name = account ? account.split("@")[0] : guestName;
	const connect = useMemo(() => {
		const scheme = location.protocol === "https:" ? "wss" : "ws";
		const url = `${scheme}://${location.host}/ws/${id}?name=${encodeURIComponent(name ?? "")}`;
		return () => createSocket(url);
	}, [id, name, createSocket]);

	if (info === undefined || account === undefined) return null;
	if (!info) {
		return (
			<main class="center">
				<h1>Nie ma takiej tablicy</h1>
				<p class="muted">
					Link jest nieprawidłowy albo tablica została usunięta.
				</p>
			</main>
		);
	}
	if (!name) {
		return (
			<NamePrompt
				onSubmit={(n) => {
					store(localStorage, NAME_KEY, n);
					setGuestName(n);
				}}
			/>
		);
	}
	return (
		<BoardView
			boardId={id}
			authorId={authorId}
			name={name}
			connect={connect}
			onSetBackground={info.owner ? (b) => api.setBackground(id, b) : undefined}
		/>
	);
}

function NamePrompt({ onSubmit }: { onSubmit: (name: string) => void }) {
	return (
		<main class="center">
			<form
				class="stack"
				onSubmit={(e) => {
					e.preventDefault();
					const name = String(
						new FormData(e.currentTarget as HTMLFormElement).get("name") ?? "",
					).trim();
					if (name) onSubmit(name);
				}}
			>
				<h1>Jak masz na imię?</h1>
				<input name="name" placeholder="Imię" maxLength={40} />
				<button type="submit" class="primary">
					Wejdź
				</button>
			</form>
		</main>
	);
}
