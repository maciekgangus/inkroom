import { cursorColor } from "./cursor-colors";
import type { Peer } from "./sync/sync";

/** How many people are shown as chips; the rest are counted. */
const MAX_SHOWN = 5;

/** The first letter or digit of a name, in capitals, or ? if it has none. */
const initial = (name: string): string =>
	name.match(/[\p{L}\p{N}]/u)?.[0].toLocaleUpperCase() ?? "?";

interface Props {
	peers: Peer[];
	/** Our own id: we come first and are marked. */
	selfId: string;
	/** Given to the board's owner: pressing another person's chip calls it (R-016). */
	onSelect?: (peer: Peer, at: { x: number; y: number }) => void;
}

/** Who is on the board right now: a coloured chip per person in the top right corner (R-046). */
export function Participants({ peers, selfId, onSelect }: Props) {
	if (peers.length === 0) return null;
	const ordered = [
		...peers.filter((p) => p.id === selfId),
		...peers.filter((p) => p.id !== selfId),
	];
	const shown = ordered.slice(0, MAX_SHOWN);
	const rest = ordered.slice(MAX_SHOWN);
	return (
		<ul class="participants" aria-label="Uczestnicy">
			{shown.map((p) => {
				const label = p.id === selfId ? `${p.name} (Ty)` : p.name;
				const color = cursorColor(p.id);
				const common = {
					class: `participant${p.id === selfId ? " self" : ""}${p.muted ? " muted" : ""}`,
					title: p.muted ? `${label}: nie może rysować` : label,
					"aria-label": label,
					"data-color": color,
					"data-name": label,
					style: { background: color },
				};
				const mark = p.muted ? (
					<span class="muted-mark" aria-hidden="true" />
				) : null;
				if (onSelect && p.id !== selfId) {
					return (
						<li key={p.id} class="participant-slot">
							<button
								type="button"
								{...common}
								onClick={(e) => {
									const r = e.currentTarget.getBoundingClientRect();
									onSelect(p, { x: r.right - 220, y: r.bottom + 8 });
								}}
							>
								{initial(p.name)}
								{mark}
							</button>
						</li>
					);
				}
				return (
					<li key={p.id} {...common}>
						{initial(p.name)}
						{mark}
					</li>
				);
			})}
			{rest.length > 0 && (
				<li
					class="participants-more"
					title={rest.map((p) => p.name).join(", ")}
					data-name={rest.map((p) => p.name).join(", ")}
				>
					+{rest.length}
				</li>
			)}
		</ul>
	);
}
