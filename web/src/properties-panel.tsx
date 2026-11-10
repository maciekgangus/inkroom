import type { Stroke } from "./board/board";
import {
	capabilities,
	type Dash,
	dashOptions,
	type StylePatch,
	styleOf,
} from "./board/style";
import { Icon } from "./icon";
import "./properties-panel.css";

/** How each line style is shown on its button; the natural pen gets a wave icon. */
const DASH_LABELS: Record<Dash, string> = {
	solid: "━",
	dashed: "╌",
	dotted: "┈",
	natural: "",
};

interface Props {
	/** The selected elements; the panel shows the values of the first. */
	elements: Stroke[];
	colors: string[];
	/** How a stored colour is shown (dark mode swaps black and white); defaults to as is. */
	display?: (color: string) => string;
	/** A change that is still being made (a slider moving): shown, but not yet final. */
	onPreview?: (patch: StylePatch) => void;
	/** A final change: a click, or a slider released. */
	onChange: (patch: StylePatch) => void;
}

/** A slider with its value next to it: `input` while moving, `change` on release. */
function Slider({
	label,
	min,
	max,
	value,
	unit,
	onInput,
	onChange,
}: {
	label: string;
	min: number;
	max: number;
	value: number;
	unit: string;
	onInput: (v: number) => void;
	onChange: (v: number) => void;
}) {
	return (
		<label class="slider">
			<input
				type="range"
				aria-label={label}
				min={min}
				max={max}
				step={1}
				value={value}
				onInput={(e) => onInput(Number(e.currentTarget.value))}
				onChange={(e) => onChange(Number(e.currentTarget.value))}
			/>
			<span class="value">
				{value}
				{unit}
			</span>
		</label>
	);
}

/** Edits the style of the selection: colour, width, line style, fill and opacity. */
export function PropertiesPanel({
	elements,
	colors,
	display = (c) => c,
	onPreview = () => {},
	onChange,
}: Props) {
	if (elements.length === 0) return null;
	const can = capabilities(elements);
	const now = styleOf(elements);
	const on = (active: boolean) => (active ? "active" : "");

	return (
		<div class="properties">
			{can.color && (
				<div class="row">
					{colors.map((c) => (
						<button
							type="button"
							key={c}
							aria-label={`prop color ${c}`}
							class={`swatch ${on(now.color === c)}`}
							style={{ background: display(c) }}
							onClick={() => onChange({ color: c })}
						/>
					))}
				</div>
			)}
			{can.size && (
				<div class="row">
					{can.textOnly ? (
						<Slider
							label="prop font size"
							min={8}
							max={200}
							value={now.fontSize}
							unit=" px"
							onInput={(v) => onPreview({ fontSize: v })}
							onChange={(v) => onChange({ fontSize: v })}
						/>
					) : (
						<Slider
							label="prop size"
							min={1}
							max={50}
							value={now.size}
							unit=" px"
							onInput={(v) => onPreview({ size: v })}
							onChange={(v) => onChange({ size: v })}
						/>
					)}
				</div>
			)}
			{can.dash && (
				<div class="row">
					{dashOptions(elements).map((dash) => (
						<button
							type="button"
							key={dash}
							aria-label={`prop dash ${dash}`}
							class={on(now.dash === dash)}
							onClick={() => onChange({ dash })}
						>
							{dash === "natural" ? <Icon name="wave" /> : DASH_LABELS[dash]}
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
							style={{ background: display(c) }}
							onClick={() => onChange({ fill: c })}
						/>
					))}
				</div>
			)}
			<div class="row">
				<Slider
					label="prop opacity"
					min={1}
					max={100}
					value={Math.round(now.opacity * 100)}
					unit="%"
					onInput={(v) => onPreview({ opacity: v / 100 })}
					onChange={(v) => onChange({ opacity: v / 100 })}
				/>
			</div>
		</div>
	);
}
