import { useEffect, useRef, useState } from "preact/hooks";
import { Icon } from "./icon";

/** The same limit as the server's. */
const MAX_LENGTH = 100;

interface Props {
	name: string;
	/** True for the owner of the board: a pen next to the name lets them change it (R-113). */
	editable: boolean;
	/** Saves a new name; a rejection means it failed and the old name stays. */
	onSave: (name: string) => Promise<void>;
	class?: string;
}

/**
 * The name of a recording: plain text for everyone, and for the owner a pen that turns it into a
 * field. Enter or leaving the field saves, Escape throws the change away; an empty or unchanged
 * name is not sent.
 */
export function EditableName({ name, editable, onSave, class: cls }: Props) {
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState(name);
	const [error, setError] = useState("");
	/** The name being saved: shown at once, so it does not flick back to the old one meanwhile. */
	const [pending, setPending] = useState("");
	const field = useRef<HTMLInputElement>(null);
	/** Set once the field is settled (saved or thrown away), so the blur that follows is ignored. */
	const settled = useRef(false);

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
		setPending(next);
		try {
			await onSave(next);
			setError("");
		} catch {
			setDraft(name);
			setError("Nie udało się zmienić nazwy");
		} finally {
			setPending("");
		}
	};

	if (editing) {
		return (
			<input
				ref={field}
				class={`name-field ${cls ?? ""}`}
				aria-label="Nazwa nagrania"
				value={draft}
				maxLength={MAX_LENGTH}
				onInput={(e) => setDraft(e.currentTarget.value)}
				onKeyDown={(e) => {
					if (e.key === "Enter") void finish(true);
					else if (e.key === "Escape") void finish(false);
				}}
				onBlur={() => void finish(true)}
			/>
		);
	}
	return (
		<span class={`name-view ${cls ?? ""}`}>
			<span class="name-text" title={pending || name}>
				{pending || name}
			</span>
			{editable && (
				<button
					type="button"
					class="name-edit"
					aria-label="Zmień nazwę nagrania"
					title="Zmień nazwę"
					onClick={() => {
						settled.current = false;
						setError("");
						setEditing(true);
					}}
				>
					<Icon name="pen" />
				</button>
			)}
			{error && (
				<span class="name-error" role="alert">
					{error}
				</span>
			)}
		</span>
	);
}
