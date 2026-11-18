import { useEffect, useRef, useState } from "preact/hooks";
import * as api from "./api";
import { renderPreview } from "./board/preview";
import {
	checkedRecently,
	markChecked,
	peekPreview,
	setPreview,
} from "./preview-cache";

/** A picture confirmed this recently is not asked for again: hopping between boards costs nothing. */
const RECHECK_MS = 20_000;

/**
 * A small picture of a board for a tile (R-052). It is fetched and drawn only when it comes into
 * view, and the drawn picture is kept per version of the board. A board seen before shows its
 * last picture at once (R-080), and is only checked in the background for a newer one, and not
 * even that when it was checked a moment ago.
 */
export function BoardPreview({
	boardId,
	mine,
}: {
	boardId: string;
	/** The owner's tile hands the picture it draws to the server (R-088). */
	mine?: boolean;
}) {
	const box = useRef<HTMLDivElement>(null);
	const last = peekPreview(boardId);
	const [src, setSrc] = useState<string | null>(last?.url ?? null);
	const [failed, setFailed] = useState(false);

	useEffect(() => {
		let gone = false;
		// Another board in the same tile: its own last picture, or none, while it loads.
		setSrc(peekPreview(boardId)?.url ?? null);
		const load = () => {
			if (checkedRecently(boardId, RECHECK_MS)) return;
			// The server's own picture first (R-088): one small image, nothing to draw.
			api.boardPreviewPicture(boardId).then((stored) => {
				if (gone) return;
				if (stored) {
					const seen = peekPreview(boardId);
					if (stored.etag && seen?.tag === stored.etag) {
						markChecked(boardId);
						setSrc(seen.url);
						return;
					}
					if (stored.etag) setPreview(boardId, stored.etag, stored.url);
					setSrc(stored.url);
					return;
				}
				drawIt();
			}, drawIt);
		};
		const drawIt = () => {
			api.boardPreview(boardId).then(
				({ etag, data }) => {
					if (gone) return;
					const seen = peekPreview(boardId);
					if (etag && seen?.tag === etag) {
						markChecked(boardId); // unchanged: the picture shown is the current one
						setSrc(seen.url);
						return;
					}
					const url = renderPreview(data);
					if (etag) setPreview(boardId, etag, url);
					setSrc(url);
					// A tile that had to draw it leaves the picture with the server for the next one.
					if (etag && mine)
						api.storePreviewPicture(boardId, etag, url).catch(() => {});
				},
				() => {
					if (!gone) setFailed(true);
				}, // no picture: the tile still has its name and buttons
			);
		};
		const el = box.current;
		if (!el || typeof IntersectionObserver === "undefined") {
			load();
			return () => {
				gone = true;
			};
		}
		// A little before it is in view, so the picture is there when it scrolls in.
		const seen = new IntersectionObserver(
			(entries) => {
				if (entries.some((e) => e.isIntersecting)) {
					seen.disconnect();
					load();
				}
			},
			{ rootMargin: "300px 0px" },
		);
		seen.observe(el);
		return () => {
			gone = true;
			seen.disconnect();
		};
	}, [boardId]);

	return (
		<div class={`preview-box${src || failed ? "" : " loading"}`} ref={box}>
			{src && <img class="preview" src={src} alt="" loading="lazy" />}
		</div>
	);
}
