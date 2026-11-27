import { useEffect, useState } from "preact/hooks";
import * as api from "../api";
import { EditableName } from "../editable-name";
import { clock } from "../recording-controls";
import { getJSON, type PlayIndex, playIndexUrl } from "./load";

/** How often the page asks again while the video is being prepared. */
export const POLL_MS = 5000;

interface Props {
	boardId: string;
	recId: string;
}

/**
 * The video rendered from a recording (R-115), in an ordinary video player: the browser's own
 * controls (play, seek, speed, full screen). While the server still prepares it the page says how
 * far it is and starts the video by itself once it is ready.
 */
export function VideoView({ boardId, recId }: Props) {
	const [index, setIndex] = useState<PlayIndex | { error: string } | null>(
		null,
	);
	const [name, setName] = useState("");
	const [owner, setOwner] = useState(false);

	useEffect(() => {
		let gone = false;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const poll = async () => {
			try {
				const next = await getJSON<PlayIndex>(playIndexUrl(boardId, recId));
				if (gone) return;
				setIndex(next);
				setName((was) => was || next.name);
				// Asked again while it is not ready; a failure or a missing video will not change.
				if (next.videoState === "queued" || next.videoState === "rendering")
					timer = setTimeout(poll, POLL_MS);
			} catch (e) {
				if (!gone) setIndex({ error: e instanceof Error ? e.message : "Błąd" });
			}
		};
		void poll();
		return () => {
			gone = true;
			clearTimeout(timer);
		};
	}, [boardId, recId]);

	useEffect(() => {
		let gone = false;
		api.boardInfo(boardId).then(
			(info) => !gone && setOwner(!!info?.owner),
			() => {},
		);
		return () => {
			gone = true;
		};
	}, [boardId]);

	if (index && "error" in index) {
		return (
			<main class="center">
				<h1>Nie można pokazać wideo</h1>
				<p class="muted">{index.error}</p>
				<a class="nav-link" href={`/b/${boardId}`}>
					Wróć do tablicy
				</a>
			</main>
		);
	}

	return (
		<div class="video-page">
			<div class="replay-top">
				<a class="replay-back" href={`/b/${boardId}`}>
					← Tablica
				</a>
				{index ? (
					<EditableName
						class="replay-name"
						name={name || index.name}
						editable={owner}
						onSave={async (next) => {
							await api.renameRecording(boardId, recId, next);
							setName(next);
						}}
					/>
				) : (
					<span class="replay-name">Wczytywanie…</span>
				)}
				<a class="replay-back" href={`/b/${boardId}/r/${recId}`}>
					Odtwórz na tablicy
				</a>
				{index?.video && (
					<a
						class="replay-back"
						href={`/api/boards/${boardId}/recordings/${recId}/video`}
						download
					>
						Pobierz wideo
					</a>
				)}
			</div>
			<div class="video-stage">
				{index?.video ? (
					// biome-ignore lint/a11y/useMediaCaption: the video is a lesson's own voice
					<video
						class="video-player"
						src={index.video}
						controls
						playsInline
						preload="metadata"
						autoplay={false}
					/>
				) : index ? (
					<Preparing index={index} />
				) : null}
			</div>
		</div>
	);
}

function Preparing({ index }: { index: PlayIndex }) {
	switch (index.videoState) {
		case "queued":
			return (
				<div class="video-note" role="status">
					<strong>Wideo czeka w kolejce</strong>
					<span class="muted">
						Serwer przygotuje je w tle. Ta strona odświeży się sama.
					</span>
				</div>
			);
		case "rendering":
			return (
				<div class="video-note" role="status">
					<strong>Przygotowuję wideo… {index.videoProgress}%</strong>
					<progress max={100} value={index.videoProgress} />
					<span class="muted">
						Lekcja trwa {clock(index.durationMs)}. Strona odświeży się sama.
					</span>
				</div>
			);
		case "failed":
			return (
				<div class="video-note" role="alert">
					<strong>Nie udało się przygotować wideo</strong>
					<span class="muted">Nagranie można nadal odtworzyć na tablicy.</span>
				</div>
			);
		default:
			return (
				<div class="video-note" role="status">
					<strong>Ta lekcja nie ma wideo</strong>
					<span class="muted">Można ją odtworzyć na tablicy.</span>
				</div>
			);
	}
}
