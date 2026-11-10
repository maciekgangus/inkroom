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
}

/** Who is on the board right now: a coloured chip per person in the top right corner (R-046). */
export function Participants({ peers, selfId }: Props) {
	if (peers.length === 0) return null;
	const ordered = [
		...peers.filter((p) => p.id === selfId),
		...peers.filter((p) => p.id !== selfId),
	];
	const shown = ordered.slice(0, MAX_SHOWN);
	const rest = ordered.slice(MAX_SHOWN);
	return (
		<div class="participants" role="list" aria-label="Uczestnicy">
			{shown.map((p) => {
				const label = p.id === selfId ? `${p.name} (Ty)` : p.name;
				const color = cursorColor(p.id);
				return (
					<div
						key={p.id}
						role="listitem"
						class={`participant${p.id === selfId ? " self" : ""}`}
						title={label}
						aria-label={label}
						data-color={color}
						style={{ background: color }}
					>
						{initial(p.name)}
					</div>
				);
			})}
			{rest.length > 0 && (
				<div
					class="participants-more"
					title={rest.map((p) => p.name).join(", ")}
				>
					+{rest.length}
				</div>
			)}
		</div>
	);
}
