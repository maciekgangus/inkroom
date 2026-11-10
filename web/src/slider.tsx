/** Width of the slider's thumb in px; the CSS draws it this size and the fill follows its middle. */
export const THUMB_PX = 16;

/** A slider with its value next to it: `input` while moving, `change` on release. */
export function Slider({
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
	// The thumb's middle travels from half a thumb to half a thumb short of the end, so the fill
	// is drawn to that point: `--p` is the position along that travel (see the CSS).
	const span = max - min;
	const p = span > 0 ? Math.min(1, Math.max(0, (value - min) / span)) : 0;
	return (
		<label class="slider">
			<input
				style={{ "--p": String(p) }}
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
				{Math.round(value)}
				{unit}
			</span>
		</label>
	);
}
