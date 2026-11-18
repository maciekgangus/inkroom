import type { ComponentChildren } from "preact";
import type { Stroke } from "./board/board";
import {
	capabilities,
	dashOptions,
	planeOf,
	type StylePatch,
	styleOf,
} from "./board/style";
import type { Rect } from "./board/viewport";
import { CustomColor } from "./custom-color";
import {
	isVisible,
	panelTitle,
	pickSide,
	type Side,
	sidePosition,
} from "./floating-panel";
import { FunctionEditor } from "./function-editor";
import { Icon } from "./icon";
import { Slider } from "./slider";
import "./properties-panel.css";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { LINE_STYLES, SIZES, WIDTH_SHOWN } from "./stroke-controls";

/** The menu's width (254px, 278px on a touch screen) with room to spare, for choosing its side. */
const MENU_WIDTH = 280;
/** The same for a coordinate plane, whose menu is wide (up to 400px). */
const WIDE_MENU_WIDTH = 420;
/** The side of the tile that opens the menu again (44px on a touch screen). */
const TILE = 44;

/** Where the column of tools on the left edge of an upright tablet ends (R-082), or 0 without it. */
const railEnd = (): number => {
	const rail = document.querySelector(".toolbar.rail");
	return rail ? Math.ceil(rail.getBoundingClientRect().right) + 8 : 0;
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
		sideOf.current = {
			key: ids,
			side: pickSide(
				anchor,
				capabilities(elements).plane ? WIDE_MENU_WIDTH : MENU_WIDTH,
				view,
			),
		};
	const side = sideOf.current?.side ?? "right";
	// An object that is off the screen takes its menu and tile with it.
	if (anchor && !isVisible(anchor, view)) return null;
	if (collapsed) {
		const spot = anchor
			? sidePosition(anchor, { w: TILE, h: TILE }, view, side, railEnd())
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
	const spot = anchor
		? sidePosition(anchor, size, view, side, railEnd())
		: null;
	const at = spot
		? { left: spot.left + offset.x, top: spot.top + offset.y }
		: null;
	const can = capabilities(elements);
	const now = styleOf(elements);
	const plane = planeOf(elements);
	const on = (active: boolean) => (active ? "active" : "");

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: the handler only keeps the focus where it is
		<div
			ref={ref}
			class={`properties${can.plane ? " wide" : ""}${at ? " floating" : ""}`}
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
						class="panel-close icon"
						aria-label="close panel"
						title="Zamknij"
						onClick={onClose}
					>
						<Icon name="close" />
					</button>
				)}
			</div>
			<div class="panel-body">
				{can.color && (
					<Group>
						<ColorRow
							prefix="prop color"
							current={now.color}
							colors={palette ?? colors}
							display={display}
							onPreview={(c) => onPreview({ color: c })}
							onPick={(c) => c !== null && onChange({ color: c })}
						/>
					</Group>
				)}
				{can.fill && (
					<Group>
						<ColorRow
							prefix="prop fill"
							allowNone
							current={now.fill}
							colors={palette ?? colors}
							display={display}
							onPreview={(c) => onPreview({ fill: c })}
							onPick={(c) => onChange({ fill: c })}
						/>
					</Group>
				)}
				{((can.size && !can.textOnly && !can.plane) || can.dash) && (
					<Group>
						{can.size &&
							!can.textOnly &&
							!can.plane &&
							SIZES.map((s) => (
								<button
									type="button"
									key={s}
									class={`icon ${on(now.size === s)}`}
									aria-label={`prop size ${s}`}
									aria-pressed={now.size === s}
									title={`Grubość ${s * WIDTH_SHOWN} px`}
									onClick={() => onChange({ size: s })}
								>
									<span
										class="dot"
										style={{
											width: `${s * 2 + 2}px`,
											height: `${s * 2 + 2}px`,
										}}
									/>
								</button>
							))}
						{can.size && !can.textOnly && !can.plane && can.dash && (
							<span class="prop-sep" />
						)}
						{can.dash &&
							LINE_STYLES.filter((s) =>
								dashOptions(elements).includes(s.style),
							).map((s) => (
								<button
									type="button"
									key={s.style}
									title={s.label}
									aria-label={`prop dash ${s.style}`}
									aria-pressed={now.dash === s.style}
									class={`icon ${on(now.dash === s.style)}`}
									onClick={() => onChange({ dash: s.style })}
								>
									<Icon name={s.icon} />
								</button>
							))}
					</Group>
				)}
				<Group>
					{can.size &&
						(can.textOnly ? (
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
						))}
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
				</Group>
				{can.numbers && !can.plane && (
					<Group center>
						<button
							type="button"
							aria-label="prop numbers"
							aria-pressed={now.numbered}
							title="Numeracja 1 2 3"
							class={`icon digits ${on(now.numbered)}`}
							onClick={() => onChange({ numbered: !now.numbered })}
						>
							123
						</button>
					</Group>
				)}
				{can.plane && (
					<>
						<Group center>
							<button
								type="button"
								aria-label="prop grid"
								aria-pressed={plane.grid}
								title="Siatka"
								class={`icon ${on(plane.grid)}`}
								onClick={() => onChange({ grid: !plane.grid })}
							>
								<Icon name="grid" />
							</button>
							<button
								type="button"
								aria-label="prop axes"
								aria-pressed={plane.showAxes}
								title="Osie"
								class={`icon ${on(plane.showAxes)}`}
								onClick={() => onChange({ showAxes: !plane.showAxes })}
							>
								<Icon name="axes" />
							</button>
						</Group>
						<Group>
							<Slider
								icon="grid"
								label="prop cell"
								min={10}
								max={200}
								step={5}
								value={plane.cell}
								unit=" j."
								onInput={(v) => onPreview({ cell: v })}
								onChange={(v) => onChange({ cell: v })}
							/>
						</Group>
						<Group center>
							{(
								[
									["numbers", "123", "Numeracja 1 2 3"],
									["pi", "π", "Numeracja w π"],
									["none", null, "Bez numeracji"],
								] as const
							).map(([how, label, title]) => (
								<button
									type="button"
									key={how}
									aria-label={`prop numbering ${how}`}
									aria-pressed={plane.numbering === how}
									title={title}
									class={`icon ${label === "123" ? "digits " : ""}${on(plane.numbering === how)}`}
									onClick={() => onChange({ numbering: how })}
								>
									{label ?? <Icon name="empty-square" />}
								</button>
							))}
						</Group>
						<FunctionEditor
							fns={plane.fns}
							display={display}
							onPreview={onPreview}
							onChange={onChange}
						/>
					</>
				)}
			</div>
		</div>
	);
}

/** One group of controls, split from the next by a rule, as the groups of the wide bar. */
const Group = ({
	children,
	center = false,
}: {
	children: ComponentChildren;
	/** A row of a few switches stands in the middle, not stuck to the left. */
	center?: boolean;
}) => <div class={`prop-group${center ? " center" : ""}`}>{children}</div>;

/**
 * A row of round colour tiles, as in the bar: the current one has a ring; the last tile is for any
 * other colour (R-060). With `allowNone` the first tile clears it, so both rows have six tiles.
 */
function ColorRow({
	prefix,
	current,
	colors,
	display,
	onPreview,
	onPick,
	allowNone = false,
}: {
	prefix: string;
	current: string | null;
	colors: string[];
	display: (color: string) => string;
	onPreview: (color: string) => void;
	onPick: (color: string | null) => void;
	allowNone?: boolean;
}) {
	const [picking, setPicking] = useState(false);
	// The fill row has the "none" tile too, so it shows one colour fewer and both rows are as long.
	const shown = allowNone ? colors.slice(0, -1) : colors;
	const choose = (c: string | null) => {
		setPicking(false);
		onPick(c);
	};
	return (
		<div class="palette-grid">
			{allowNone && (
				<button
					type="button"
					aria-label={`${prefix} none`}
					title="Bez wypełnienia"
					aria-pressed={current === null}
					class={`swatch none${current === null ? " active" : ""}`}
					onClick={() => choose(null)}
				>
					<Icon name="no-fill" />
				</button>
			)}
			{shown.map((c) => (
				<button
					type="button"
					key={c}
					aria-label={`${prefix} ${c}`}
					aria-pressed={current === c}
					class={`swatch${current === c ? " active" : ""}`}
					style={{ "--swatch": display(c) }}
					onClick={() => choose(c)}
				/>
			))}
			<CustomColor
				label={`${prefix} custom`}
				current={current}
				own={current !== null && !shown.includes(current)}
				display={display}
				open={picking}
				onToggle={() => setPicking(!picking)}
				onInput={onPreview}
				onChange={onPick}
			/>
		</div>
	);
}
