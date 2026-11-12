import { useEffect, useMemo, useState } from "preact/hooks";
import * as api from "./api";
import { AuthForms, RegisterPage } from "./auth-forms";
import { BoardView, newId } from "./board-view";
import { FeedbackButton } from "./feedback-button";
import { ADMIN_NAME, isReservedName } from "./names";
import { Panel } from "./panel";
import type { SocketLike } from "./sync/sync";
import { ThemeToggle } from "./theme";

const BOARD_PATH = /^\/b\/([0-9a-f]{32})$/;
const REGISTER_PATH = "/register";
const NAME_KEY = "inkroom.name";
const AUTHOR_KEY = "inkroom.authorId";

interface Props {
	path?: string;
	/** The query string of the address; a board opened from the admin panel carries `admin=<ticket>`. */
	search?: string;
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
	search = location.search,
	navigate = goTo,
	createSocket = realSocket,
}: Props) {
	const match = BOARD_PATH.exec(path);
	return (
		<>
			{match ? (
				<BoardPage
					id={match[1]}
					ticket={new URLSearchParams(search).get("admin")}
					createSocket={createSocket}
				/>
			) : path === REGISTER_PATH ? (
				<RegisterPage navigate={navigate} />
			) : (
				<Home navigate={navigate} />
			)}
			<div class="corner">
				<FeedbackButton />
				<ThemeToggle />
			</div>
		</>
	);
}

function Home({ navigate }: { navigate: (to: string) => void }) {
	const [account, setAccount] = useState<api.Account | null | undefined>(
		undefined, // undefined: still asking the server
	);
	useEffect(() => {
		api.me().then(setAccount, () => setAccount(null));
	}, []);

	if (account === undefined) return null;
	if (account === null)
		return <AuthForms onAuth={setAccount} navigate={navigate} />;
	return (
		<Panel
			username={account.username}
			navigate={navigate}
			onLogout={() => setAccount(null)}
		/>
	);
}

function BoardPage({
	id,
	ticket,
	createSocket,
}: {
	id: string;
	/** The ticket of the admin panel: the page is then the Administrator, whoever is logged in. */
	ticket: string | null;
	createSocket: (url: string) => SocketLike;
}) {
	const [info, setInfo] = useState<
		{ owner: boolean; name: string } | null | undefined
	>(undefined);
	const [account, setAccount] = useState<api.Account | null | undefined>(
		undefined,
	);
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

	// Logged-in users are known by their username (R-053); guests give a name.
	const name = ticket ? ADMIN_NAME : account ? account.username : guestName;
	const connect = useMemo(() => {
		const scheme = location.protocol === "https:" ? "wss" : "ws";
		const url = `${scheme}://${location.host}/ws/${id}?name=${encodeURIComponent(name ?? "")}&id=${encodeURIComponent(authorId)}${ticket ? `&admin=${encodeURIComponent(ticket)}` : ""}`;
		return () => createSocket(url);
	}, [id, name, authorId, ticket, createSocket]);

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
			boardName={info.name}
			onRename={info.owner ? (n) => api.renameBoard(id, n) : undefined}
			owner={info.owner}
			onCopy={info.owner ? () => api.copyBoard(id) : undefined}
			onSetBackground={info.owner ? (b) => api.setBackground(id, b) : undefined}
		/>
	);
}

function NamePrompt({ onSubmit }: { onSubmit: (name: string) => void }) {
	const [refused, setRefused] = useState(false);
	return (
		<main class="center">
			<form
				class="stack"
				onSubmit={(e) => {
					e.preventDefault();
					const name = String(
						new FormData(e.currentTarget as HTMLFormElement).get("name") ?? "",
					).trim();
					if (isReservedName(name)) {
						setRefused(true);
						return;
					}
					setRefused(false);
					if (name) onSubmit(name);
				}}
			>
				<h1>Jak masz na imię?</h1>
				<input name="name" placeholder="Imię" maxLength={40} />
				{refused && (
					<p class="error" role="alert">
						To imię jest zarezerwowane, wybierz inne.
					</p>
				)}
				<button type="submit" class="primary">
					Wejdź
				</button>
			</form>
		</main>
	);
}
