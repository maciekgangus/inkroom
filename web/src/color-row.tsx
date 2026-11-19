import { useState } from "preact/hooks";
import { CustomColor } from "./custom-color";
import { Icon } from "./icon";

/**
 * A row of round colour tiles, as in the bar: the current one has a ring; the last tile is for any
 * other colour (R-060). With `allowNone` the first tile clears it, so both rows have six tiles.
 */
export function ColorRow({
	prefix,
	current,
	colors,
	display,
	onPreview,
	onPick,
	onChosen,
	allowNone = false,
}: {
	prefix: string;
	current: string | null;
	colors: string[];
	display: (color: string) => string;
	onPreview: (color: string) => void;
	onPick: (color: string | null) => void;
	/** After a tile of the palette (not the picker) was pressed. */
	onChosen?: () => void;
	allowNone?: boolean;
}) {
	const [picking, setPicking] = useState(false);
	// The fill row has the "none" tile too, so it shows one colour fewer and both rows are as long.
	const shown = allowNone ? colors.slice(0, -1) : colors;
	const choose = (c: string | null) => {
		setPicking(false);
		onPick(c);
		onChosen?.();
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
			{shown.map((c, i) => (
				<button
					type="button"
					key={c}
					aria-label={`${prefix} ${c}`}
					aria-pressed={current === c}
					// The last ones are left out first when the row is too narrow (CSS container query).
					class={`swatch${current === c ? " active" : ""}${i >= 6 ? " opt2" : i >= 5 ? " opt" : ""}`}
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
				popover
				onToggle={() => setPicking(!picking)}
				onInput={onPreview}
				onChange={onPick}
			/>
		</div>
	);
}
