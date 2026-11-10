import { shapeParts } from "./board/shape-parts";
import { SHAPES, type ShapeChoice } from "./board/shapes";
import { Icon } from "./icon";

/** `M x y L x y ...` for a list of polylines. */
const pathOf = (lines: [number, number][][]): string =>
	lines
		.map((l) =>
			l
				.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)}`)
				.join(""),
		)
		.join("");

/**
 * The icon of a shape of the list (R-039). The rectangle and the oval have their own; every
 * other is drawn from the same geometry as the shape itself, hidden edges dotted, so the
 * list can never disagree with what is drawn.
 */
export function ShapeIcon({ kind }: { kind: ShapeChoice }) {
	const entry = SHAPES.find((s) => s.kind === kind);
	if (entry?.icon) return <Icon name={entry.icon} />;
	// A semicircle is half as tall as it is wide, as in the picture it stands for.
	const top = kind === "semicircle" ? 8 : 3.5;
	const bottom = kind === "semicircle" ? 16.5 : 20.5;
	const parts = shapeParts(kind, [3.5, top], [20.5, bottom]);
	return (
		<svg
			width="20"
			height="20"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="1.5"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
		>
			{parts && <path d={pathOf(parts.lines)} />}
			{parts && parts.hidden.length > 0 && (
				<path d={pathOf(parts.hidden)} stroke-dasharray="0.1 2.6" />
			)}
		</svg>
	);
}
