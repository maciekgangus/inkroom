import type { Stroke } from "./board/board";
import {
	capabilities,
	type Dash,
	dashOptions,
	type StylePatch,
	styleOf,
} from "./board/style";
import type { Rect } from "./board/viewport";
import { panelPosition, panelTitle } from "./floating-panel";
import { Icon, type IconName } from "./icon";
import { Slider } from "./slider";
import "./properties-panel.css";
import { useLayoutEffect, useRef, useState } from "preact/hooks";

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
	/** The whole palette offered under the current colour; defaults to `colors`. */
	palette?: string[];
	/** How a stored colour is shown (dark mode swaps black and white); defaults to as is. */
	display?: (color: string) => string;
	/**
	 * Where the object being edited is on screen. With it the panel is attached to the object
	 * (R-042); without it, it sits in the corner.
	 */
	anchor?: Rect | null;
	/** A change that is still being made (a slider moving): shown, but not yet final. */
	onPreview?: (patch: StylePatch) => void;
	/** Puts the panel away until something else is selected (the cross in its title). */
	onClose?: () => void;
	/** A slider for tuning the selection glow by eye; shown only when given. */
	glow?: { value: number; onChange: (px: number) => void };
	/** A final change: a click, or a slider released. */
	onChange: (patch: StylePatch) => void;
}

/** Edits the style of the selection: colour, width, line style, fill and opacity. */
export function PropertiesPanel({
	elements,
	colors,
	palette,
	display = (c) => c,
	anchor = null,
	onPreview = () => {},
	onClose,
	glow,
	onChange,
}: Props) {
	const ref = useRef<HTMLDivElement>(null);
	const [size, setSize] = useState({ w: 0, h: 0 });
	// Measured after every render, as the panel grows and shrinks with what it offers.
	useLayoutEffect(() => {
		const el = ref.current;
		if (!el) return;
		const [w, h] = [el.offsetWidth, el.offsetHeight];
		if (w !== size.w || h !== size.h) setSize({ w, h });
	});
	if (elements.length === 0) return null;
	const at = anchor
		? panelPosition(anchor, size, { w: innerWidth, h: innerHeight })
		: null;
	const can = capabilities(elements);
	const now = styleOf(elements);
	const on = (active: boolean) => (active ? "active" : "");

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: the handler only keeps the focus where it is
		<div
			ref={ref}
			class={`properties${at ? " floating" : ""}`}
			style={
				at
					? {
							left: `${at.left}px`,
							top: `${at.top}px`,
							visibility: size.w === 0 ? "hidden" : undefined,
						}
					: undefined
			}
			// A click on a button must not take the focus from a text field being edited.
			onMouseDown={(e) => {
				if ((e.target as HTMLElement).tagName !== "INPUT") e.preventDefault();
			}}
		>
			<div class="panel-title">
				<span>{panelTitle(elements)}</span>
				{onClose && (
					<button
						type="button"
						class="panel-close"
						aria-label="close panel"
						title="Zamknij"
						onClick={onClose}
					>
						×
					</button>
				)}
			</div>
			{can.color && (
				<div class="row">
					<ColorBlock
						icon="pen"
						prefix="prop color"
						current={now.color}
						colors={palette ?? colors}
						display={display}
						onPick={(c) => c !== null && onChange({ color: c })}
					/>
				</div>
			)}
			{can.size && (
				<div class="row">
					{can.textOnly ? (
						<Slider
							icon="text"
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
							icon="width"
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
					<ColorBlock
						icon="bucket"
						prefix="prop fill"
						current={now.fill}
						colors={palette ?? colors}
						display={display}
						onPick={(c) => onChange({ fill: c })}
						allowNone
					/>
				</div>
			)}
			<div class="row">
				<Slider
					icon="opacity"
					label="prop opacity"
					min={1}
					max={100}
					value={Math.round(now.opacity * 100)}
					unit="%"
					onInput={(v) => onPreview({ opacity: v / 100 })}
					onChange={(v) => onChange({ opacity: v / 100 })}
				/>
			</div>
			{glow && (
				<div class="row">
					<Slider
						icon="width"
						label="prop glow"
						min={0}
						max={40}
						value={glow.value}
						unit=" px"
						onInput={glow.onChange}
						onChange={glow.onChange}
					/>
				</div>
			)}
		</div>
	);
}

/**
 * A colour to choose: a window showing the current one (or that there is none), and under it the
 * palette with a tile of its own for any other colour. With `allowNone` the first tile clears it.
 */
function ColorBlock({
	icon,
	prefix,
	current,
	colors,
	display,
	onPick,
	allowNone = false,
}: {
	icon: IconName;
	prefix: string;
	current: string | null;
	colors: string[];
	display: (color: string) => string;
	onPick: (color: string | null) => void;
	allowNone?: boolean;
}) {
	return (
		<div class="color-block">
			<div class="color-current">
				<span class="color-icon">
					<Icon name={icon} />
				</span>
				<span
					class={`chip${current === null ? " none" : ""}`}
					style={
						current === null ? undefined : { background: display(current) }
					}
				>
					{current === null && <Icon name="no-fill" />}
				</span>
				<span class="color-name">
					{current === null ? "brak" : display(current).toUpperCase()}
				</span>
			</div>
			<div class="palette-grid">
				{allowNone && (
					<button
						type="button"
						aria-label={`${prefix} none`}
						title="Bez wypełnienia"
						class={`swatch none ${current === null ? "active" : ""}`}
						onClick={() => onPick(null)}
					>
						<Icon name="no-fill" />
					</button>
				)}
				{colors.map((c) => (
					<button
						type="button"
						key={c}
						aria-label={`${prefix} ${c}`}
						class={`swatch ${current === c ? "active" : ""}`}
						style={{ background: display(c) }}
						onClick={() => onPick(c)}
					/>
				))}
				<label class="swatch custom" title="Własny kolor">
					<input
						type="color"
						aria-label={`${prefix} custom`}
						value={
							current && /^#[0-9a-f]{6}$/i.test(current) ? current : "#5b5bf0"
						}
						onInput={(e) => onPick((e.currentTarget as HTMLInputElement).value)}
					/>
					<Icon name="plus" />
				</label>
			</div>
		</div>
	);
}
