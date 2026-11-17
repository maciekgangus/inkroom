import { useEffect, useState } from "preact/hooks";
import { Icon } from "./icon";
import { hasFinePointer } from "./pointer";

/** How long "Skopiowano link" stays. */
const SAID_MS = 2000;

/**
 * Shares the link of the board (R-083): copies it and says so for a moment; where the browser
 * has the system share sheet and the main pointer is a finger (an iPad), opens that instead.
 */
export function ShareButton({
	boardId,
	title,
}: {
	boardId: string;
	title?: string;
}) {
	const [said, setSaid] = useState(false);
	useEffect(() => {
		if (!said) return;
		const t = setTimeout(() => setSaid(false), SAID_MS);
		return () => clearTimeout(t);
	}, [said]);

	const share = async () => {
		const url = `${location.origin}/b/${boardId}`;
		if (typeof navigator.share === "function" && !hasFinePointer()) {
			try {
				await navigator.share({ title, url });
			} catch {
				// closed without sharing: nothing to say
			}
			return;
		}
		try {
			await navigator.clipboard?.writeText(url);
			setSaid(true);
		} catch {
			// the clipboard is refused (no HTTPS, no permission): the panel's link stays
		}
	};

	return (
		<div class="share-wrap">
			<button
				type="button"
				class="board-menu"
				aria-label="share"
				title="Udostępnij"
				onClick={share}
			>
				<Icon name="share" />
			</button>
			{said && (
				<span class="share-said" role="status">
					Skopiowano link
				</span>
			)}
		</div>
	);
}
