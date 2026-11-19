import { Icon } from "./icon";

/** "1 osoba Cię śledzi", "2 osoby Cię śledzą", "5 osób Cię śledzi". */
export function watchersLabel(n: number): string {
	if (n === 1) return "1 osoba Cię śledzi";
	const few = n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14);
	return few ? `${n} osoby Cię śledzą` : `${n} osób Cię śledzi`;
}

interface Props {
	/** Name of the person whose view we follow. */
	following?: string;
	onStop: () => void;
	/** Name of the owner who invited us to a shared view. */
	invite?: string;
	onJoin: () => void;
	onDismiss: () => void;
	/** Name of the person we followed until we moved the view ourselves. */
	lost?: string;
	onBack: () => void;
	/** A short word shown for a moment, e.g. that following was not allowed. */
	notice?: string;
	/** How many people follow our view. */
	watchers: number;
	/** Given to the board's owner: invites everybody to look where they look. */
	onShowMyView?: () => void;
}

/**
 * The quiet strip under the top bar for following someone's view (R-093): whom we follow (with a
 * cross to stop), the owner's invitation, the way back after moving the view ourselves, a notice,
 * and, for the one who is watched, how many watch.
 */
export function FollowBar({
	following,
	onStop,
	invite,
	onJoin,
	onDismiss,
	lost,
	onBack,
	notice,
	watchers,
	onShowMyView,
}: Props) {
	return (
		<div class="follow-bar" role="status" aria-live="polite">
			{onShowMyView && (
				<div class="follow-chip">
					<button
						type="button"
						class="chip-text"
						title="Zaproś wszystkich do swojego widoku"
						onClick={onShowMyView}
					>
						<Icon name="eye" />
						<span>Pokaż mój widok</span>
					</button>
				</div>
			)}
			{watchers > 0 && (
				<div class="follow-chip watchers" title={watchersLabel(watchers)}>
					<Icon name="eye" />
					<span>{watchersLabel(watchers)}</span>
				</div>
			)}
			{following && (
				<div class="follow-chip following">
					<Icon name="eye" />
					<span>
						Śledzisz: <b>{following}</b>
					</span>
					<button
						type="button"
						class="chip-button"
						aria-label="Przestań śledzić"
						title="Przestań śledzić"
						onClick={onStop}
					>
						<Icon name="close" />
					</button>
				</div>
			)}
			{!following && lost && (
				<div class="follow-chip">
					<button
						type="button"
						class="chip-text"
						aria-label={`Wróć do widoku: ${lost}`}
						onClick={onBack}
					>
						<Icon name="eye" />
						<span>Wróć do widoku: {lost}</span>
					</button>
				</div>
			)}
			{invite && (
				<div class="follow-chip invite">
					<span>Prowadzący zaprasza do wspólnego widoku</span>
					<button type="button" class="chip-primary" onClick={onJoin}>
						Dołącz
					</button>
					<button
						type="button"
						class="chip-button"
						aria-label="Odrzuć"
						title="Odrzuć"
						onClick={onDismiss}
					>
						<Icon name="close" />
					</button>
				</div>
			)}
			{notice && <div class="follow-chip notice">{notice}</div>}
		</div>
	);
}
