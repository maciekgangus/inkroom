import { useEffect, useState } from "preact/hooks";
import type { Settings } from "./board/controller";
import type { Dash } from "./board/style";
import { closeOnDismiss } from "./dismiss";
import { Icon } from "./icon";
import { Slider } from "./slider";

/** The three ready widths of the quick settings: fine, so the middle one is comfortable to write with. */
export const SIZES = [1, 2, 4];

/**
 * The width shown is this many times the width drawn: a line of 1 px reads as "2 px", so the
 * numbers feel like those of a marker and need not match the screen.
 */
export const WIDTH_SHOWN = 2;

/** What the line style list offers, with the icon of each (R-038). */
export const LINE_STYLES: {
	style: Dash;
	label: string;
	icon: "style-solid" | "style-dashed" | "style-dotted" | "wave";
}[] = [
	{ style: "natural", label: "Naturalne pióro", icon: "wave" },
	{ style: "solid", label: "Ciągła", icon: "style-solid" },
	{ style: "dashed", label: "Kreskowana", icon: "style-dashed" },
	{ style: "dotted", label: "Kropkowana", icon: "style-dotted" },
];

interface Props {
	/** Shown in a list (R-082) instead of as buttons that open lists of their own. */
	inline?: boolean;
	settings: Settings;
	/** Changes settings of new elements; the toolbar mutates `settings` and redraws. */
	onChange: (patch: Partial<Settings>) => void;
}

/**
 * The settings of new elements in the toolbar (R-038), in two levels: the quick, ready widths,
 * and behind two buttons the detail: a window with sliders for width and opacity, and a list of
 * line styles with icons, like the list of shapes.
 */
export function StrokeControls({ settings, onChange, inline }: Props) {
	const [open, setOpen] = useState<"stroke" | "style" | null>(null);
	const on = (active: boolean) => (active ? "active" : "");

	// Escape or a press outside closes whichever is open; opening one closes the other.
	useEffect(() => {
		if (!open) return;
		return closeOnDismiss(".flyout-wrap", () => setOpen(null));
	}, [open]);

	// Lines and shapes have no natural pen: they draw the classic style, and show it (R-073).
	const chosen = settings.lineStyle ?? "solid";
	const shown =
		chosen === "natural" &&
		(settings.tool === "line" || settings.tool === "shape")
			? "solid"
			: chosen;
	const current = LINE_STYLES.find((s) => s.style === shown) ?? LINE_STYLES[1];

	// Only the pen straightens its strokes into shapes (R-095).
	const snapToggle =
		settings.tool === "pen" ? (
			<button
				type="button"
				role="switch"
				aria-checked={!!settings.snapShapes}
				aria-label="snap shapes"
				title="Przytrzymaj rysik na końcu kreski, a zamieni się w równy kształt"
				class={`snap-toggle ${on(!!settings.snapShapes)}`}
				onClick={() => onChange({ snapShapes: !settings.snapShapes })}
			>
				<span class="snap-check" aria-hidden="true" />
				Idealne kształty
			</button>
		) : null;

	const sizeButtons = SIZES.map((s) => (
		<button
			type="button"
			key={s}
			aria-label={`size ${s}`}
			aria-pressed={settings.size === s}
			class={on(settings.size === s)}
			onClick={() => onChange({ size: s })}
		>
			<span
				class="dot"
				style={{ width: `${s * 2 + 2}px`, height: `${s * 2 + 2}px` }}
			/>
		</button>
	));
	const sliders = (
		<>
			{!inline && <span class="slider-title">Grubość</span>}
			<Slider
				label="stroke width"
				min={0.25 * WIDTH_SHOWN}
				max={50 * WIDTH_SHOWN}
				step={0.25 * WIDTH_SHOWN}
				value={settings.size * WIDTH_SHOWN}
				unit=" px"
				onInput={(v) => onChange({ size: v / WIDTH_SHOWN })}
				onChange={(v) => onChange({ size: v / WIDTH_SHOWN })}
			/>
			<span class="slider-title">Przezroczystość</span>
			<Slider
				label="stroke opacity"
				min={1}
				max={100}
				value={Math.round((settings.opacity ?? 1) * 100)}
				unit="%"
				onInput={(v) => onChange({ opacity: v / 100 })}
				onChange={(v) => onChange({ opacity: v / 100 })}
			/>
		</>
	);

	if (inline)
		return (
			<>
				<div class="settings-sizes">{sizeButtons}</div>
				<div class="settings-sliders">{sliders}</div>
				<span class="settings-title">Styl linii</span>
				<div class="settings-styles">
					{LINE_STYLES.map((s) => (
						<button
							type="button"
							key={s.style}
							aria-label={`line style ${s.style}`}
							aria-pressed={s.style === current.style}
							class={on(s.style === current.style)}
							onClick={() => onChange({ lineStyle: s.style })}
						>
							<Icon name={s.icon} />
							{s.label}
						</button>
					))}
				</div>
				{snapToggle}
			</>
		);

	return (
		<>
			{SIZES.map((s) => (
				<button
					type="button"
					key={s}
					aria-label={`size ${s}`}
					aria-pressed={settings.size === s}
					class={on(settings.size === s)}
					onClick={() => onChange({ size: s })}
				>
					<span
						class="dot"
						style={{ width: `${s * 2 + 2}px`, height: `${s * 2 + 2}px` }}
					/>
				</button>
			))}
			<div class="flyout-wrap">
				<button
					type="button"
					aria-label="stroke settings"
					aria-expanded={open === "stroke"}
					title="Grubość i przezroczystość"
					class={`has-list ${on(open === "stroke")}`}
					onClick={() => setOpen(open === "stroke" ? null : "stroke")}
				>
					<Icon name="sliders" />
				</button>
				{open === "stroke" && (
					<div class="stroke-popover">
						<span class="slider-title">Grubość</span>
						<Slider
							label="stroke width"
							min={0.25 * WIDTH_SHOWN}
							max={50 * WIDTH_SHOWN}
							step={0.25 * WIDTH_SHOWN}
							value={settings.size * WIDTH_SHOWN}
							unit=" px"
							onInput={(v) => onChange({ size: v / WIDTH_SHOWN })}
							onChange={(v) => onChange({ size: v / WIDTH_SHOWN })}
						/>
						<span class="slider-title">Przezroczystość</span>
						<Slider
							label="stroke opacity"
							min={1}
							max={100}
							value={Math.round((settings.opacity ?? 1) * 100)}
							unit="%"
							onInput={(v) => onChange({ opacity: v / 100 })}
							onChange={(v) => onChange({ opacity: v / 100 })}
						/>
						{snapToggle}
					</div>
				)}
			</div>
			<div class="flyout-wrap">
				<button
					type="button"
					aria-label="line style"
					aria-expanded={open === "style"}
					title="Styl linii"
					class={`has-list ${on(open === "style")}`}
					onClick={() => setOpen(open === "style" ? null : "style")}
				>
					<Icon name={current.icon} />
				</button>
				{open === "style" && (
					<div class="style-list" role="menu">
						{LINE_STYLES.map((s) => (
							<button
								type="button"
								role="menuitem"
								key={s.style}
								aria-label={`line style ${s.style}`}
								class={on(s.style === current.style)}
								onClick={() => {
									onChange({ lineStyle: s.style });
									setOpen(null);
								}}
							>
								<Icon name={s.icon} />
								{s.label}
							</button>
						))}
					</div>
				)}
			</div>
		</>
	);
}
