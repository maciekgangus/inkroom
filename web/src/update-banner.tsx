import { useEffect, useState } from "preact/hooks";
import { Icon } from "./icon";
import { type VersionWatch, versionWatch } from "./version";

interface Props {
	watch?: VersionWatch;
	reload?: () => void;
}

/**
 * A calm card at the bottom of the page when the server runs a newer release than this page
 * (R-099). It never reloads by itself and does not appear while a pen or finger is down: it waits
 * for the stroke to end.
 */
export function UpdateBanner({
	watch = versionWatch,
	reload = () => location.reload(),
}: Props) {
	const [, rerender] = useState(0);
	const [pressed, setPressed] = useState(false);
	useEffect(() => watch.subscribe(() => rerender((n) => n + 1)), [watch]);
	useEffect(() => {
		// A press on the banner is a click on its buttons, not a stroke: hiding it would eat the click.
		const down = (e: Event) => {
			if (!(e.target as Element | null)?.closest?.(".update-banner")) {
				setPressed(true);
			}
		};
		const up = () => setPressed(false);
		window.addEventListener("pointerdown", down, true);
		window.addEventListener("pointerup", up, true);
		window.addEventListener("pointercancel", up, true);
		return () => {
			window.removeEventListener("pointerdown", down, true);
			window.removeEventListener("pointerup", up, true);
			window.removeEventListener("pointercancel", up, true);
		};
	}, []);
	if (!watch.visible || pressed) return null;
	return (
		<div class="update-banner" role="status" aria-live="polite">
			<Icon name="refresh" />
			<span>Dostępna nowa wersja Inkroom</span>
			<button type="button" class="update-reload" onClick={reload}>
				Odśwież
			</button>
			<button
				type="button"
				class="update-close"
				aria-label="Zamknij"
				title="Zamknij"
				onClick={() => watch.dismiss()}
			>
				<Icon name="close" />
			</button>
		</div>
	);
}
