import { useEffect, useRef, useState } from "preact/hooks";

/** The same limit as the server's (100 characters). */
const MAX_LENGTH = 100;

interface Props {
	name: string;
	/** True for the owner of the board: they can rename it by clicking the name (R-045). */
	editable: boolean;
	/** Saves a new name; a rejection means it failed and the old name stays. */
	onRename: (name: string) => Promise<void>;
}

/** The name of the board at the top left; the owner clicks it to change it. */
export function BoardTitle({ name, editable, onRename }: Props) {
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState(name);
	const [error, setError] = useState("");
	const field = useRef<HTMLInputElement>(null);
	/** Set once the field is settled (saved or cancelled), so the blur that follows is ignored. */
	const settled = useRef(false);

	// A name that arrives from outside (another tab, the owner's other device) shows at once.
	useEffect(() => {
		if (!editing) setDraft(name);
	}, [name, editing]);

	useEffect(() => {
		if (editing) {
			field.current?.focus();
			field.current?.select();
		}
	}, [editing]);

	const finish = async (save: boolean) => {
		if (settled.current) return;
		settled.current = true;
		setEditing(false);
		const next = draft.trim();
		if (!save || !next || next === name) {
			setDraft(name);
			return;
		}
		try {
			await onRename(next);
			setError("");
		} catch {
			setDraft(name);
			setError("Nie udało się zmienić nazwy");
		}
	};

	if (!editable) {
		return (
			<div class="board-title">
				<span class="name" title={name}>
					{name}
				</span>
			</div>
		);
	}
	return (
		<div class="board-title">
			{editing ? (
				<>
					<input
						ref={field}
						aria-label="board name"
						value={draft}
						maxLength={MAX_LENGTH}
						onInput={(e) =>
							setDraft((e.currentTarget as HTMLInputElement).value)
						}
						onBlur={() => finish(true)}
						onKeyDown={(e) => {
							if (e.key === "Enter") finish(true);
							if (e.key === "Escape") finish(false);
						}}
					/>
					<button
						type="button"
						class="name-ok"
						aria-label="save name"
						title="Zapisz nazwę (Enter)"
						onMouseDown={(e) => e.preventDefault()}
						onClick={() => finish(true)}
					>
						✓
					</button>
				</>
			) : (
				<button
					type="button"
					class="name"
					title={`${name} (kliknij, aby zmienić nazwę)`}
					onClick={() => {
						settled.current = false;
						setError("");
						setEditing(true);
					}}
				>
					{name}
				</button>
			)}
			{error && (
				<span class="board-title-error" role="alert">
					{error}
				</span>
			)}
		</div>
	);
}
