import { useEffect, useRef, useState } from "preact/hooks";
import * as api from "./api";
import { renderPreview } from "./board/preview";
import { getPreview, setPreview } from "./preview-cache";

/**
 * A small picture of a board for a tile (R-052). It is fetched and drawn only when it comes into
 * view, and the drawn picture is kept per version of the board, so coming back costs one cheap
 * "not modified" answer and no drawing.
 */
export function BoardPreview({ boardId }: { boardId: string }) {
	const box = useRef<HTMLDivElement>(null);
	const [src, setSrc] = useState<string | null>(null);

	useEffect(() => {
		let gone = false;
		const load = () => {
			api.boardPreview(boardId).then(
				({ etag, data }) => {
					if (gone) return;
					const kept = etag ? getPreview(boardId, etag) : null;
					const url = kept ?? renderPreview(data);
					if (!kept && etag) setPreview(boardId, etag, url);
					setSrc(url);
				},
				() => {}, // no picture: the tile still has its name and buttons
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
		<div class="preview-box" ref={box}>
			{src && <img class="preview" src={src} alt="" loading="lazy" />}
		</div>
	);
}
