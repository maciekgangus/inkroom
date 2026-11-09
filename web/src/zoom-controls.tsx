import { MAX_SCALE, MIN_SCALE } from "./board/viewport";

interface Props {
	scale: number;
	onZoomIn: () => void;
	onZoomOut: () => void;
	onReset: () => void;
}

/** Zoom out, current zoom (click to reset to 100%), zoom in; sits in a corner of the screen. */
export function ZoomControls({ scale, onZoomIn, onZoomOut, onReset }: Props) {
	return (
		<div class="zoom">
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
		</div>
	);
}
