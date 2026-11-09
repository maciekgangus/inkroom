import type { Viewport } from "./board/viewport";
import { cursorColor } from "./cursor-colors";
import type { RemoteCursor } from "./sync/sync";

interface Props {
	cursors: RemoteCursor[];
	viewport: Viewport;
}

/** Other people's cursors, drawn as HTML above the board so moving them never repaints the strokes. */
export function Cursors({ cursors, viewport }: Props) {
	return (
		<div class="cursors" aria-hidden="true">
			{cursors.map((c) => {
				const [x, y] = viewport.toScreen(c.x, c.y);
				const color = cursorColor(c.id);
				return (
					<div
						key={c.id}
						class="cursor"
						style={{ transform: `translate(${x}px, ${y}px)`, color }}
					>
						<svg
							width="18"
							height="18"
							viewBox="0 0 18 18"
							fill="currentColor"
							aria-hidden="true"
						>
							<path
								d="M1 1 L1 15 L5 11.5 L8 17 L10.5 15.8 L7.6 10.4 L13 10.2 Z"
								stroke="#fff"
								stroke-width="1"
							/>
						</svg>
						<span class="label" style={{ background: color }}>
							{c.name}
						</span>
					</div>
				);
			})}
		</div>
	);
}
