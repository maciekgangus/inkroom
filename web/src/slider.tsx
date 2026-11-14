import { clamp } from "./board/clamp";
import { Icon, type IconName } from "./icon";
/** Width of the slider's thumb in px; the CSS draws it this size and the fill follows its middle. */
export const THUMB_PX = 16;

/** A slider with its value next to it: `input` while moving, `change` on release. */
export function Slider({
	icon,
	label,
	min,
	max,
	step = 1,
	value,
	unit,
	onInput,
	onChange,
}: {
	/** An icon in front, saying what the slider is for. */
	icon?: IconName;
	label: string;
	min: number;
	max: number;
	/** How far one notch moves the value; a finer step shows the fraction. */
	step?: number;
	value: number;
	unit: string;
	onInput: (v: number) => void;
	onChange: (v: number) => void;
}) {
	// The thumb's middle travels from half a thumb to half a thumb short of the end, so the fill
	// is drawn to that point: `--p` is the position along that travel (see the CSS).
	const span = max - min;
	const p = span > 0 ? clamp((value - min) / span, 0, 1) : 0;
	return (
		<label class="slider">
			{icon && (
				<span class="slider-icon">
					<Icon name={icon} />
				</span>
			)}
			<input
				style={{ "--p": String(p) }}
				type="range"
				aria-label={label}
				min={min}
				max={max}
				step={step}
				value={value}
				onInput={(e) => onInput(Number(e.currentTarget.value))}
				onChange={(e) => onChange(Number(e.currentTarget.value))}
			/>
			<span class="value">
				{Number(value.toFixed(2))}
				{unit}
			</span>
		</label>
	);
}
