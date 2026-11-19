/** Where an arc of the rainbow ring starts, as the angle (degrees clockwise from the top) of the first. */
const START = 200;
const ARCS = 8;
/** The ring, in a 40 by 40 box with its centre in (20, 20): outer radius 14, 3 thick. */
const R_RING = 12.5;
/** The colour: 9 across with a hairline round it, so its outer radius is 9, 2 clear of the ring. */
const R_DOT = 8.5;
/** The selection: one ring outside the rainbow, 4 clear of it, 2 thick. */
const R_SEL = 19;
const C = 20;

const point = (r: number, deg: number): string => {
	const a = (deg * Math.PI) / 180;
	return `${(C + r * Math.sin(a)).toFixed(3)} ${(C - r * Math.cos(a)).toFixed(3)}`;
};

/** One arc of the ring from `from` to `to` degrees (a hair longer, so that no seam shows). */
const arc = (from: number, to: number): string =>
	`M${point(R_RING, from)}A${R_RING} ${R_RING} 0 0 1 ${point(R_RING, to)}`;

/**
 * The fourth place of the colour bar (R-079) as one SVG: the rainbow ring, the gap, the colour
 * (`--well` of the button) and the ring of the selection, all circles round the same point, so
 * nothing can drift off the middle. With no colour in it, a plus is drawn.
 */
export function ColorWell({ empty }: { empty: boolean }) {
	const step = 360 / ARCS;
	return (
		<svg
			class="well"
			width="40"
			height="40"
			viewBox="0 0 40 40"
			shape-rendering="geometricPrecision"
			aria-hidden="true"
		>
			<defs>
				{Array.from({ length: ARCS }, (_, i) => {
					const a = START + i * step;
					const [x1, y1] = point(R_RING, a).split(" ");
					const [x2, y2] = point(R_RING, a + step).split(" ");
					return (
						<linearGradient
							key={i}
							id={`well-g${i}`}
							gradientUnits="userSpaceOnUse"
							x1={x1}
							y1={y1}
							x2={x2}
							y2={y2}
						>
							<stop offset="0" style={{ stopColor: `var(--well-c${i})` }} />
							<stop
								offset="1"
								style={{ stopColor: `var(--well-c${(i + 1) % ARCS})` }}
							/>
						</linearGradient>
					);
				})}
			</defs>
			<g class="ring" fill="none" stroke-width="3">
				{Array.from({ length: ARCS }, (_, i) => {
					const a = START + i * step;
					return (
						<path
							key={i}
							d={arc(a - 0.4, a + step + 0.4)}
							stroke={`url(#well-g${i})`}
						/>
					);
				})}
			</g>
			<circle
				class="sel"
				cx={C}
				cy={C}
				r={R_SEL}
				fill="none"
				stroke="var(--accent)"
				stroke-width="2"
			/>
			<circle
				cx={C}
				cy={C}
				r={R_DOT}
				fill="var(--well)"
				stroke="var(--swatch-edge)"
				stroke-width="1"
			/>
			{empty && (
				<path
					d="M20 16v8M16 20h8"
					fill="none"
					stroke="currentColor"
					stroke-width="1.75"
					stroke-linecap="round"
				/>
			)}
		</svg>
	);
}
