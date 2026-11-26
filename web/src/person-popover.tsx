import { useEffect } from "preact/hooks";
import { avatarUrl } from "./avatars";
import { closeOnDismiss } from "./dismiss";
import { Icon, type IconName } from "./icon";

export interface PersonPopoverAction {
	label: string;
	icon: IconName;
	onSelect: () => void | Promise<void>;
	tone?: "default" | "accent" | "danger";
	disabled?: boolean;
	/** Draws a subtle hairline divider above this action. */
	sepBefore?: boolean;
}

export interface PersonPopoverProps {
	/** Anchor point in client pixels. */
	x: number;
	y: number;
	username: string;
	avatar?: string;
	/** Optional cursor ring color (used on the live whiteboard). */
	ringColor?: string;
	/** Short context under the username (e.g. "Właściciel", "Współwłaściciel"). */
	subtitle?: string;
	/** Marks the person with a quiet "Znajomy" badge in the card header. */
	isFriend?: boolean;
	/** Optional quiet note at the bottom (e.g. for guests without an account). */
	note?: string;
	actions: PersonPopoverAction[];
	onClose: () => void;
}

const WIDTH = 264;
const ROW = 42;
const HEADER_H = 62;

/**
 * Quiet Desk contextual card for any person shown on the whiteboard or in the panel (R-123).
 * Lets the user save/remove a friend, promote to co-owner, follow view, or filter their boards in 1 click.
 */
export function PersonPopover({
	x,
	y,
	username,
	avatar,
	ringColor,
	subtitle,
	isFriend,
	note,
	actions,
	onClose,
}: PersonPopoverProps) {
	useEffect(() => {
		const stop = closeOnDismiss(".person-popover", onClose);
		addEventListener("wheel", onClose, { passive: true });
		return () => {
			stop();
			removeEventListener("wheel", onClose);
		};
	}, [onClose]);

	const estHeight = HEADER_H + actions.length * ROW + (note ? 40 : 0) + 16;
	const left = Math.max(8, Math.min(x, innerWidth - WIDTH - 8));
	const top = Math.max(8, Math.min(y, innerHeight - estHeight - 8));
	const picture = avatarUrl(avatar);
	const initial =
		username.match(/[\p{L}\p{N}]/u)?.[0].toLocaleUpperCase() ?? "?";

	return (
		<div
			class="person-popover"
			role="menu"
			aria-label={`Osoba: ${username}`}
			style={{ left: `${left}px`, top: `${top}px` }}
		>
			<div class="person-popover-head">
				<span
					class={`person-popover-avatar${ringColor ? " has-ring" : ""}`}
					style={ringColor ? { background: ringColor } : undefined}
					aria-hidden="true"
				>
					{picture ? (
						<img src={picture} alt="" width="34" height="34" />
					) : (
						initial
					)}
				</span>
				<span class="person-popover-id">
					<span class="person-popover-name-row">
						<span class="person-popover-name">{username}</span>
						{isFriend && (
							<span class="person-friend-badge" title="Zapisany znajomy">
								<Icon name="check" />
								Znajomy
							</span>
						)}
					</span>
					{subtitle && <span class="muted person-popover-sub">{subtitle}</span>}
				</span>
			</div>

			{actions.length > 0 && (
				<div class="person-popover-actions">
					{actions.map((item) => (
						<div key={item.label} class="person-popover-slot">
							{item.sepBefore && <hr class="popover-sep" />}
							<button
								type="button"
								role="menuitem"
								class={
									item.tone === "accent"
										? "person-act-accent"
										: item.tone === "danger"
											? "popover-danger"
											: undefined
								}
								disabled={item.disabled}
								onClick={() => {
									void item.onSelect();
									onClose();
								}}
							>
								<Icon name={item.icon} />
								<span>{item.label}</span>
							</button>
						</div>
					))}
				</div>
			)}

			{note && <p class="muted person-popover-note">{note}</p>}
		</div>
	);
}
