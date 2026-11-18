import type { ComponentChildren } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { closeOnDismiss } from "./dismiss";
import { popoverSpot } from "./floating-panel";
import { Icon } from "./icon";
import { Portal } from "./portal";
import { Slider } from "./slider";

type Hsl = [number, number, number];

/** A #rrggbb colour as hue (0–359), saturation and lightness (0–100). */
export function hexToHsl(hex: string): Hsl {
	const n = Number.parseInt(hex.slice(1), 16);
	const r = ((n >> 16) & 255) / 255;
	const g = ((n >> 8) & 255) / 255;
	const b = (n & 255) / 255;
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const l = (max + min) / 2;
	const d = max - min;
	if (d === 0) return [0, 0, Math.round(l * 100)];
	const s = d / (1 - Math.abs(2 * l - 1));
	let h =
		max === r
			? ((g - b) / d) % 6
			: max === g
				? (b - r) / d + 2
				: (r - g) / d + 4;
	h = Math.round(h * 60);
	if (h < 0) h += 360;
	return [h % 360, Math.round(s * 100), Math.round(l * 100)];
}

/** Hue, saturation and lightness as a #rrggbb colour. */
export function hslToHex(h: number, s: number, l: number): string {
	const L = l / 100;
	const a = (s / 100) * Math.min(L, 1 - L);
	const f = (n: number) => {
		const k = (n + h / 30) % 12;
		return L - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
	};
	const hex = (x: number) =>
		Math.round(x * 255)
			.toString(16)
			.padStart(2, "0");
	return `#${hex(f(0))}${hex(f(8))}${hex(f(4))}`;
}

/** Where the picker starts: the colour given (a grey gets some saturation), else the accent. */
function startOf(color: string | null): Hsl {
	const ok = color !== null && /^#[0-9a-f]{6}$/i.test(color);
	const [h, s, l] = hexToHsl(ok ? (color as string) : "#5b5bf0");
	return [h, s < 10 ? 85 : s, Math.min(90, Math.max(10, l))];
}

/**
 * The last, round tile of a colour row: a dashed ring with a plus, or the person's own colour.
 * Pressed, it opens a picker under the row (hue and shade), part of the list so nothing is cut off.
 */
export function CustomColor({
	label,
	current,
	own,
	display,
	open,
	onToggle,
	onInput,
	onChange,
	popover = false,
}: {
	/** aria-label of the tile; the sliders get " hue" and " shade" after it. */
	label: string;
	current: string | null;
	/** The current colour is none of the tiles before: this tile shows it and is marked. */
	own: boolean;
	display: (color: string) => string;
	open: boolean;
	/** Pressed on the tile; with `popover`, also a click outside the picker or Escape (shuts it). */
	onToggle: () => void;
	/** While a slider moves. */
	onInput: (color: string) => void;
	/** When a slider is released. */
	onChange: (color: string) => void;
	/**
	 * The picker is a little window of its own beside the menu the tile is in, pinned to the tile, so
	 * that it does not push the menu's contents down; inside the menu only if there is no room beside.
	 */
	popover?: boolean;
}) {
	const tile = useRef<HTMLButtonElement>(null);
	const picker = (
		<ColorPicker
			label={label}
			start={current === null ? null : display(current)}
			onInput={onInput}
			onChange={onChange}
		/>
	);
	return (
		<>
			<button
				ref={tile}
				type="button"
				aria-label={label}
				aria-expanded={open}
				title="Własny kolor"
				class={`swatch custom${own ? " own active" : ""}`}
				style={own && current ? { "--swatch": display(current) } : undefined}
				onClick={onToggle}
			>
				{!own && <Icon name="plus" />}
			</button>
			{open &&
				(popover ? (
					<ColorPopover tile={tile} onClose={onToggle}>
						{picker}
					</ColorPopover>
				) : (
					picker
				))}
		</>
	);
}

const rectOf = (el: Element) => {
	const r = el.getBoundingClientRect();
	return { minX: r.left, minY: r.top, maxX: r.right, maxY: r.bottom };
};

/**
 * A picker in a window of its own, outside the menu: beside it, level with the tile, kept on the
 * screen, following the tile if the menu is moved or scrolled. It shuts on a click or touch
 * outside it and on Escape. With no room beside the menu it stays inside, under the row.
 */
function ColorPopover({
	tile,
	onClose,
	children,
}: {
	tile: { current: HTMLButtonElement | null };
	onClose: () => void;
	children: ComponentChildren;
}) {
	const box = useRef<HTMLDivElement>(null);
	/** null: not measured yet; "inside": no room beside the menu. */
	const [spot, setSpot] = useState<
		{ left: number; top: number } | "inside" | null
	>(null);
	useLayoutEffect(() => {
		let frame = 0;
		const place = () => {
			const t = tile.current;
			const menu = t?.closest(".properties");
			const b = box.current;
			if (t && menu && b) {
				const next = popoverSpot(
					rectOf(t),
					rectOf(menu),
					{ w: b.offsetWidth, h: b.offsetHeight },
					{ w: innerWidth, h: innerHeight },
				);
				setSpot((prev) =>
					next === null
						? prev === "inside"
							? prev
							: "inside"
						: typeof prev === "object" &&
								prev !== null &&
								prev.left === next.left &&
								prev.top === next.top
							? prev
							: next,
				);
			}
			frame = requestAnimationFrame(place);
		};
		place();
		return () => cancelAnimationFrame(frame);
	}, [tile]);
	useLayoutEffect(
		() => closeOnDismiss(".color-popover, .swatch.custom", onClose),
		[onClose],
	);
	if (spot === "inside") return <>{children}</>;
	return (
		<Portal>
			<div
				ref={box}
				class="color-popover"
				style={
					spot
						? { left: `${spot.left}px`, top: `${spot.top}px` }
						: { visibility: "hidden" }
				}
			>
				{children}
			</div>
		</Portal>
	);
}

function ColorPicker({
	label,
	start,
	onInput,
	onChange,
}: {
	label: string;
	start: string | null;
	onInput: (color: string) => void;
	onChange: (color: string) => void;
}) {
	const [hsl, setHsl] = useState(() => startOf(start));
	const [h, s, l] = hsl;
	const move = (next: Hsl, final: boolean) => {
		setHsl(next);
		(final ? onChange : onInput)(hslToHex(...next));
	};
	return (
		<div
			class="color-picker"
			style={{
				"--thumb": hslToHex(h, s, l),
				"--shade": `linear-gradient(to right, hsl(${h} ${s}% 10%), hsl(${h} ${s}% 50%), hsl(${h} ${s}% 90%))`,
			}}
		>
			<div class="hue">
				<Slider
					label={`${label} hue`}
					min={0}
					max={359}
					value={h}
					unit=""
					onInput={(v) => move([v, s, l], false)}
					onChange={(v) => move([v, s, l], true)}
				/>
			</div>
			<div class="shade">
				<Slider
					label={`${label} shade`}
					min={10}
					max={90}
					value={l}
					unit=""
					onInput={(v) => move([h, s, v], false)}
					onChange={(v) => move([h, s, v], true)}
				/>
			</div>
		</div>
	);
}
