import type { Stroke } from "./board/board";
import {
	capabilities,
	type Dash,
	type StylePatch,
	styleOf,
} from "./board/style";
import "./properties-panel.css";

const SIZES = [2, 5, 10];
const DASHES: { dash: Dash; label: string }[] = [
	{ dash: "solid", label: "━" },
	{ dash: "dashed", label: "╌" },
	{ dash: "dotted", label: "┈" },
];
const OPACITIES = [1, 0.6, 0.3];

interface Props {
	/** The selected elements; the panel shows the values of the first. */
	elements: Stroke[];
	colors: string[];
	onChange: (patch: StylePatch) => void;
}

/** Edits the style of the selection: colour, width, line style, fill and opacity. */
export function PropertiesPanel({ elements, colors, onChange }: Props) {
	if (elements.length === 0) return null;
	const can = capabilities(elements);
	const now = styleOf(elements);
	const on = (active: boolean) => (active ? "active" : "");

	return (
		<div class="properties" role="group" aria-label="properties">
			{can.color && (
				<div class="row">
					{colors.map((c) => (
						<button
							type="button"
							key={c}
							aria-label={`prop color ${c}`}
							class={`swatch ${on(now.color === c)}`}
							style={{ background: c }}
							onClick={() => onChange({ color: c })}
						/>
					))}
				</div>
			)}
			{can.size && (
				<div class="row">
					{SIZES.map((s) => (
						<button
							type="button"
							key={s}
							aria-label={`prop size ${s}`}
							class={on(now.size === s)}
							onClick={() => onChange({ size: s })}
						>
							<span
								class="dot"
								style={{ width: `${s + 2}px`, height: `${s + 2}px` }}
							/>
						</button>
					))}
				</div>
			)}
			{can.dash && (
				<div class="row">
					{DASHES.map(({ dash, label }) => (
						<button
							type="button"
							key={dash}
							aria-label={`prop dash ${dash}`}
							class={on(now.dash === dash)}
							onClick={() => onChange({ dash })}
						>
							{label}
						</button>
					))}
				</div>
			)}
			{can.fill && (
				<div class="row">
					<button
						type="button"
						aria-label="prop fill none"
						class={on(now.fill === null)}
						onClick={() => onChange({ fill: null })}
					>
						Bez wypełnienia
					</button>
					{colors.map((c) => (
						<button
							type="button"
							key={c}
							aria-label={`prop fill ${c}`}
							class={`swatch ${on(now.fill === c)}`}
							style={{ background: c }}
							onClick={() => onChange({ fill: c })}
						/>
					))}
				</div>
			)}
			<div class="row">
				{OPACITIES.map((o) => (
					<button
						type="button"
						key={o}
						aria-label={`prop opacity ${o}`}
						class={on(Math.abs(now.opacity - o) < 0.05)}
						onClick={() => onChange({ opacity: o })}
					>
						{Math.round(o * 100)}%
					</button>
				))}
			</div>
		</div>
	);
}
