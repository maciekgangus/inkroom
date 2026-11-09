import { useState } from "preact/hooks";
import type { Settings } from "./board/controller";

export const COLORS = ["#111111", "#d32f2f", "#1976d2", "#388e3c", "#f57c00"];
/** Extra colours behind the palette button (R-021). */
export const MORE_COLORS = [
	"#6b7280",
	"#8d5a2b",
	"#e91e63",
	"#c026d3",
	"#7c3aed",
	"#3f51b5",
	"#0ea5e9",
	"#0d9488",
	"#22c55e",
	"#84cc16",
	"#eab308",
	"#ff7043",
];
export const SIZES = [2, 5, 10];

interface Props {
	settings: Settings;
	onUndo: () => void;
	onRedo: () => void;
}

/** Icon outlines on a 24 by 24 grid, drawn as one stroked path each. */
const ICONS = {
	pen: "M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z",
	line: "M5 19 19 5",
	rect: "M6 5h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z",
	circle: "M12 4a8 8 0 1 0 0 16a8 8 0 0 0 0-16Z",
	text: "M5 7V4h14v3M12 4v16M9 20h6",
	eraser:
		"m7 21-4.3-4.3a1 1 0 0 1 0-1.4l10-10a1 1 0 0 1 1.4 0l5.6 5.6a1 1 0 0 1 0 1.4L13 21M22 21H7M5 11l9 9",
	pan: "M18 11V6a2 2 0 0 0-4 0M14 10V4a2 2 0 0 0-4 0v2M10 10.5V6a2 2 0 0 0-4 0v8M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15",
	undo: "M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11",
	redo: "m15 14 5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13",
	plus: "M12 5v14M5 12h14",
};

function Icon({ name }: { name: keyof typeof ICONS }) {
	return (
		<svg
			width="20"
			height="20"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="1.75"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
		>
			<path d={ICONS[name]} />
		</svg>
	);
}

const TOOLS: { tool: Settings["tool"]; label: string }[] = [
	{ tool: "pen", label: "Pióro" },
	{ tool: "line", label: "Linia" },
	{ tool: "rect", label: "Prostokąt" },
	{ tool: "circle", label: "Okrąg" },
	{ tool: "text", label: "Tekst" },
	{ tool: "eraser", label: "Gumka" },
	{ tool: "pan", label: "Ręka" },
];

/** Tools that draw something in the chosen colour. */
const colourTools: Settings["tool"][] = [
	"pen",
	"line",
	"rect",
	"circle",
	"text",
];

/** Tool palette: tools, color, size, undo/redo. Mutates `settings` in place. */
export function Toolbar({ settings, onUndo, onRedo }: Props) {
	const [, rerender] = useState(0);
	const set = (patch: Partial<Settings>) => {
		Object.assign(settings, patch);
		rerender((n) => n + 1);
	};
	const [paletteOpen, setPaletteOpen] = useState(false);
	const on = (active: boolean) => (active ? "active" : "");
	const drawing = colourTools.includes(settings.tool);
	const custom = !COLORS.includes(settings.color);
	// Picking a colour while erasing or panning goes back to the pen; shapes and text stay.
	const pick = (color: string) =>
		set({
			color,
			tool: colourTools.includes(settings.tool) ? settings.tool : "pen",
		});
	const swatch = (c: string, after?: () => void) => (
		<button
			type="button"
			key={c}
			aria-label={`color ${c}`}
			aria-pressed={drawing && settings.color === c}
			class={`swatch ${on(drawing && settings.color === c)}`}
			style={{ background: c }}
			onClick={() => {
				pick(c);
				after?.();
			}}
		/>
	);

	return (
		<div class="toolbar">
			<div class="group">
				{TOOLS.map(({ tool, label }) => (
					<button
						type="button"
						key={tool}
						aria-label={tool}
						aria-pressed={settings.tool === tool}
						title={label}
						class={on(settings.tool === tool)}
						onClick={() => set({ tool })}
					>
						<Icon name={tool} />
					</button>
				))}
			</div>
			<div class="group">
				{COLORS.map((c) => swatch(c))}
				<button
					type="button"
					aria-label="more colors"
					aria-pressed={drawing && custom}
					aria-expanded={paletteOpen}
					title="Więcej kolorów"
					class={`swatch more ${on(drawing && custom)}`}
					style={custom ? { background: settings.color } : undefined}
					onClick={() => setPaletteOpen(!paletteOpen)}
				>
					{!custom && <Icon name="plus" />}
				</button>
				{paletteOpen && (
					<div class="palette">
						{MORE_COLORS.map((c) => swatch(c, () => setPaletteOpen(false)))}
						<label class="custom">
							Własny kolor
							<input
								type="color"
								aria-label="custom color"
								value={custom ? settings.color : "#5b5bf0"}
								onInput={(e) =>
									pick((e.currentTarget as HTMLInputElement).value)
								}
							/>
						</label>
					</div>
				)}
			</div>
			<div class="group">
				{SIZES.map((s) => (
					<button
						type="button"
						key={s}
						aria-label={`size ${s}`}
						aria-pressed={settings.size === s}
						class={on(settings.size === s)}
						onClick={() => set({ size: s })}
					>
						<span
							class="dot"
							style={{ width: `${s + 2}px`, height: `${s + 2}px` }}
						/>
					</button>
				))}
			</div>
			<div class="group">
				<button type="button" aria-label="undo" title="Cofnij" onClick={onUndo}>
					<Icon name="undo" />
				</button>
				<button type="button" aria-label="redo" title="Ponów" onClick={onRedo}>
					<Icon name="redo" />
				</button>
			</div>
		</div>
	);
}
