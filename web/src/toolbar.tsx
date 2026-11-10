import { useState } from "preact/hooks";
import type { Settings } from "./board/controller";
import { Icon } from "./icon";
import { ImageControls, type ImageControlsProps } from "./image-controls";
import { selectTool, TOOL_KEYS } from "./shortcuts";
import { displayColor, useTheme } from "./theme";

export const COLORS = ["#111111", "#d32f2f", "#1976d2", "#388e3c", "#f57c00"];
/** Extra colours behind the palette button (R-025). */
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
	/** True while something is selected: the properties panel then owns colour and size. */
	hasSelection?: boolean;
	/** The image group (add, and on a tablet paste and delete); left out, there is none. */
	images?: ImageControlsProps;
	/** Called after the tool changed, so the board can show the matching cursor at once. */
	onToolChange?: () => void;
	onUndo: () => void;
	onRedo: () => void;
}

const TOOLS: { tool: Settings["tool"]; label: string }[] = [
	{ tool: "select", label: "Zaznacz" },
	{ tool: "pen", label: "Pióro" },
	{ tool: "line", label: "Linia" },
	{ tool: "rect", label: "Prostokąt" },
	{ tool: "circle", label: "Owal" },
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
export function Toolbar({
	settings,
	hasSelection = false,
	images,
	onToolChange,
	onUndo,
	onRedo,
}: Props) {
	const [, rerender] = useState(0);
	const set = (patch: Partial<Settings>) => {
		Object.assign(settings, patch);
		rerender((n) => n + 1);
		if (patch.tool) onToolChange?.();
	};
	const [paletteOpen, setPaletteOpen] = useState(false);
	const theme = useTheme();
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
			style={{ background: displayColor(c, theme) }}
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
						title={
							TOOL_KEYS[tool] ? `${label} (${TOOL_KEYS[tool]?.label})` : label
						}
						class={on(settings.tool === tool)}
						onClick={() => {
							selectTool(settings, tool);
							rerender((n) => n + 1);
							onToolChange?.();
						}}
					>
						<Icon name={tool} />
					</button>
				))}
			</div>
			{!hasSelection && (
				<div class="group">
					{COLORS.map((c) => swatch(c))}
					<button
						type="button"
						aria-label="more colors"
						aria-pressed={drawing && custom}
						aria-expanded={paletteOpen}
						title="Więcej kolorów"
						class={`swatch more ${on(drawing && custom)}`}
						style={
							custom
								? { background: displayColor(settings.color, theme) }
								: undefined
						}
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
			)}
			{!hasSelection && (
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
			)}
			{images && <ImageControls {...images} />}
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
