/** One choice of a segmented control. */
export interface Choice<T extends string> {
	value: T;
	label: string;
}

/** A row of pills of which exactly one is on, a labelled group of toggle buttons (R-091). */
export function Segmented<T extends string>({
	label,
	value,
	choices,
	onChange,
}: {
	label: string;
	value: T;
	choices: Choice<T>[];
	onChange: (v: T) => void;
}) {
	return (
		<div class="filter-field">
			<span class="filter-label" aria-hidden="true">
				{label}
			</span>
			<fieldset class="segmented" aria-label={label}>
				{choices.map((c) => (
					<button
						key={c.value}
						type="button"
						aria-pressed={value === c.value}
						onClick={() => onChange(c.value)}
					>
						{c.label}
					</button>
				))}
			</fieldset>
		</div>
	);
}
