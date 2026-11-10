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
	return (
		<label class="slider">
			<input
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
