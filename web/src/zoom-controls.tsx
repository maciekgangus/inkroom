import { MAX_SCALE, MIN_SCALE } from "./board/viewport";
import { Icon } from "./icon";

interface Props {
	scale: number;
	onZoomIn: () => void;
	onZoomOut: () => void;
	onReset: () => void;
	/** Shows everything on the board; the button is offered with it. */
	onFit?: () => void;
	/** Whether the mini map is shown, and the switch for it; offered together. */
	mapOpen?: boolean;
	onToggleMap?: () => void;
}

/** Zoom out, current zoom (click to reset to 100%), zoom in; sits in a corner of the screen. */
export function ZoomControls({
	scale,
	onZoomIn,
	onZoomOut,
	onReset,
	onFit,
	mapOpen = false,
	onToggleMap,
}: Props) {
	return (
		<div class="zoom">
			{onFit && (
				<button
					type="button"
					aria-label="show all"
					title="Pokaż całą tablicę"
					onClick={onFit}
				>
					<Icon name="fit" />
				</button>
			)}
			<button
				type="button"
				aria-label="zoom out"
				disabled={scale <= MIN_SCALE}
				onClick={onZoomOut}
			>
				−
			</button>
			<button
				type="button"
				aria-label="zoom reset"
				class="level"
				onClick={onReset}
			>
				{Math.round(scale * 100)}%
			</button>
			<button
				type="button"
				aria-label="zoom in"
				disabled={scale >= MAX_SCALE}
				onClick={onZoomIn}
			>
				+
			</button>
			{onToggleMap && (
				<button
					type="button"
					aria-label="mini map"
					aria-pressed={mapOpen}
					class={mapOpen ? "active" : ""}
					title="Mapa tablicy"
					onClick={onToggleMap}
				>
					<Icon name="map" />
				</button>
			)}
		</div>
	);
}
