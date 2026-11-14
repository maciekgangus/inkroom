import type { Stroke } from "./board/board";
import {
	capabilities,
	type Dash,
	dashOptions,
	type StylePatch,
	styleOf,
} from "./board/style";
import type { Rect } from "./board/viewport";
import {
	isVisible,
	panelTitle,
	pickSide,
	type Side,
	sidePosition,
} from "./floating-panel";
import { Icon, type IconName } from "./icon";
import { Slider } from "./slider";
import "./properties-panel.css";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { WIDTH_SHOWN } from "./stroke-controls";

/** How each line style is shown on its button; the natural pen gets a wave icon. */
const DASH_LABELS: Record<Dash, string> = {
	solid: "━",
	dashed: "╌",
	dotted: "┈",
	natural: "",
};

/** The most the menu is wide, and the side of its tile, in px. */
const MENU_WIDTH = 270;
const TILE = 40;

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
	/** Shut: only a small tile is left by the object; pressing it calls `onExpand` (R-060). */
	collapsed?: boolean;
	onExpand?: () => void;
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
	collapsed = false,
	onExpand,
	onChange,
}: Props) {
	const ref = useRef<HTMLDivElement>(null);
	/** How far the menu has been dragged from its place by the object: for the moment only. */
	const [moved, setMoved] = useState({ x: 0, y: 0, key: "" });
	/** Where a drag of the title began: the pointer and the offset then. */
	const drag = useRef<{
		x: number;
		y: number;
		from: { x: number; y: number };
	} | null>(null);
	const [size, setSize] = useState({ w: 0, h: 0 });
	// Shut and opened again, or on another object, the menu is back by its object (R-060): the move
	// belongs to the object and to one opening of the menu (the key changes with each).
	const turn = useRef({ collapsed, n: 0 });
	if (turn.current.collapsed !== collapsed)
		turn.current = { collapsed, n: turn.current.n + 1 };
	const opening = turn.current.n;
	const objectKey = `${elements.map((e) => e.id).join(",")}|${opening}`;
	const offset = moved.key === objectKey ? moved : { x: 0, y: 0 };
	// Measured after every render, as the panel grows and shrinks with what it offers.
	useLayoutEffect(() => {
		const el = ref.current;
		if (!el) return;
		const [w, h] = [el.offsetWidth, el.offsetHeight];
		if (w !== size.w || h !== size.h) setSize({ w, h });
	});
	/** The side of the object the menu and its tile stand on: chosen once per object. */
	const sideOf = useRef<{ key: string; side: Side } | null>(null);
	if (elements.length === 0) return null;
	const view = { w: innerWidth, h: innerHeight };
	const ids = elements.map((e) => e.id).join(",");
	if (anchor && sideOf.current?.key !== ids)
		sideOf.current = { key: ids, side: pickSide(anchor, MENU_WIDTH, view) };
	const side = sideOf.current?.side ?? "right";
	// An object that is off the screen takes its menu and tile with it.
	if (anchor && !isVisible(anchor, view)) return null;
	if (collapsed) {
		const spot = anchor
			? sidePosition(anchor, { w: TILE, h: TILE }, view, side)
			: null;
		return (
			<button
				type="button"
				class="panel-tile"
				aria-label="Pokaż menu obiektu"
				title="Pokaż menu obiektu"
				style={
					spot
						? {
								left: `${spot.left}px`,
								top: `${spot.top}px`,
							}
						: undefined
				}
				onMouseDown={(e) => e.preventDefault()}
				onClick={onExpand}
			>
				<Icon name="sliders" />
			</button>
		);
	}
	const spot = anchor ? sidePosition(anchor, size, view, side) : null;
	const at = spot
		? { left: spot.left + offset.x, top: spot.top + offset.y }
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
			<div
				class="panel-title"
				onPointerDown={(e) => {
					if ((e.target as HTMLElement).closest(".panel-close")) return;
					drag.current = { x: e.clientX, y: e.clientY, from: offset };
					(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
				}}
				onPointerMove={(e) => {
					const d = drag.current;
					if (d)
						setMoved({
							x: d.from.x + e.clientX - d.x,
							y: d.from.y + e.clientY - d.y,
							key: objectKey,
						});
				}}
				onPointerUp={() => {
					drag.current = null;
				}}
				onPointerCancel={() => {
					drag.current = null;
				}}
			>
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
							min={0.25 * WIDTH_SHOWN}
							max={50 * WIDTH_SHOWN}
							step={0.25 * WIDTH_SHOWN}
							value={now.size * WIDTH_SHOWN}
							unit=" px"
							onInput={(v) => onPreview({ size: v / WIDTH_SHOWN })}
							onChange={(v) => onChange({ size: v / WIDTH_SHOWN })}
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
			{can.numbers && (
				<div class="row">
					<button
						type="button"
						aria-label="prop numbers"
						aria-pressed={now.numbered}
						class={on(now.numbered)}
						onClick={() => onChange({ numbered: !now.numbered })}
					>
						Numeracja 1 2 3
					</button>
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
	// A colour that is not on the palette sits on the last tile, which then shows it.
	// The fill row has the "none" tile too, so it shows one colour fewer and both rows have as many tiles.
	const shown = allowNone ? colors.slice(0, -1) : colors;
	const own = current !== null && !shown.includes(current);
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
				{shown.map((c) => (
					<button
						type="button"
						key={c}
						aria-label={`${prefix} ${c}`}
						class={`swatch ${current === c ? "active" : ""}`}
						style={{ background: display(c) }}
						onClick={() => onPick(c)}
					/>
				))}
				<label
					class={`swatch custom${own ? " active" : ""}`}
					title="Własny kolor"
					style={own && current ? { background: display(current) } : undefined}
				>
					<input
						type="color"
						aria-label={`${prefix} custom`}
						value={
							current && /^#[0-9a-f]{6}$/i.test(current) ? current : "#5b5bf0"
						}
						onInput={(e) => onPick((e.currentTarget as HTMLInputElement).value)}
					/>
					{!own && <Icon name="plus" />}
				</label>
			</div>
		</div>
	);
}
