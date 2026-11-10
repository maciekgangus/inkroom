import { useEffect, useState } from "preact/hooks";
import type { Settings } from "./board/controller";
import type { Dash } from "./board/style";
import { Icon } from "./icon";
import { Slider } from "./slider";

/** The three ready widths of the quick settings. */
export const SIZES = [2, 5, 10];

/** What the line style list offers, with the icon of each (R-038). */
const LINE_STYLES: {
	style: Dash;
	label: string;
	icon: "style-solid" | "style-dashed" | "style-dotted" | "wave";
}[] = [
	{ style: "solid", label: "Ciągła", icon: "style-solid" },
	{ style: "dashed", label: "Kreskowana", icon: "style-dashed" },
	{ style: "dotted", label: "Kropkowana", icon: "style-dotted" },
	{ style: "natural", label: "Naturalne pióro", icon: "wave" },
];

interface Props {
	settings: Settings;
	/** Changes settings of new elements; the toolbar mutates `settings` and redraws. */
	onChange: (patch: Partial<Settings>) => void;
}

/**
 * The settings of new elements in the toolbar (R-038), in two levels: the quick, ready widths,
 * and behind two buttons the detail: a window with sliders for width and opacity, and a list of
 * line styles with icons, like the list of shapes.
 */
export function StrokeControls({ settings, onChange }: Props) {
	const [open, setOpen] = useState<"stroke" | "style" | null>(null);
	const on = (active: boolean) => (active ? "active" : "");

	// Escape or a press outside closes whichever is open; opening one closes the other.
	useEffect(() => {
		if (!open) return;
		const close = () => setOpen(null);
		const key = (e: KeyboardEvent) => e.key === "Escape" && close();
		const outside = (e: Event) => {
			if (!(e.target as HTMLElement).closest?.(".flyout-wrap")) close();
		};
		addEventListener("keydown", key);
		addEventListener("pointerdown", outside, true);
		return () => {
			removeEventListener("keydown", key);
			removeEventListener("pointerdown", outside, true);
		};
	}, [open]);

	const current =
		LINE_STYLES.find((s) => s.style === (settings.lineStyle ?? "solid")) ??
		LINE_STYLES[0];

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
						style={{ width: `${s + 2}px`, height: `${s + 2}px` }}
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
							min={1}
							max={50}
							value={settings.size}
							unit=" px"
							onInput={(v) => onChange({ size: v })}
							onChange={(v) => onChange({ size: v })}
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
