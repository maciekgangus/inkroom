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
	// The browser fills the track only up to the middle of the thumb, so at the maximum it looks
	// unfilled; the fill is drawn from this value instead.
	const fill = Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100));
	return (
		<label class="slider">
			<input
				style={{ "--fill": `${fill}%` }}
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
				{value}
				{unit}
			</span>
		</label>
	);
}
