import { ArrowsClockwise, CloudCheck, SignOut, UserCircle } from "@phosphor-icons/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCloud } from "@/contexts/CloudContext";

const ACCENT = "#ff3b30";
const GLOW = "#ff5247";

function formatLastSynced(lastSyncAt: number | null): string {
	if (!lastSyncAt) return "Not synced yet";
	const diffMs = Date.now() - lastSyncAt;
	if (diffMs < 0) return "Just now";
	const sec = Math.floor(diffMs / 1000);
	if (sec < 10) return "Just now";
	if (sec < 60) return `${sec}s ago`;
	const min = Math.floor(sec / 60);
	if (min < 60) return `${min} min ago`;
	const hr = Math.floor(min / 60);
	if (hr < 24) return `${hr} hr ago`;
	return new Date(lastSyncAt).toLocaleString();
}

export function AccountPanel({ embedded = false }: { embedded?: boolean } = {}) {
	const { status, ready, signIn, signUp, signOut, syncNow } = useCloud();
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	const handleAuth = async (mode: "in" | "up") => {
		setError(null);
		const trimmedEmail = email.trim();
		if (!trimmedEmail || !password) {
			setError("Enter your email and password.");
			return;
		}
		setBusy(true);
		try {
			const result = mode === "in"
				? await signIn(trimmedEmail, password)
				: await signUp(trimmedEmail, password);
			if (!result.success) {
				setError(result.error ?? "Something went wrong. Please try again.");
			} else {
				setPassword("");
			}
		} finally {
			setBusy(false);
		}
	};

	const handleSignOut = async () => {
		setBusy(true);
		try {
			await signOut();
			setEmail("");
			setPassword("");
			setError(null);
		} finally {
			setBusy(false);
		}
	};

	const handleSyncNow = async () => {
		setBusy(true);
		try {
			await syncNow();
		} finally {
			setBusy(false);
		}
	};

	const body = !ready ? (
		<div className="flex items-center gap-2 pt-6 text-sm text-muted-foreground">
			<ArrowsClockwise className="h-4 w-4 animate-spin" />
			Loading account…
		</div>
	) : status.signedIn ? (
		<SignedIn status={status} busy={busy} onSyncNow={handleSyncNow} onSignOut={handleSignOut} />
	) : (
		<SignedOut
			email={email}
			password={password}
			busy={busy}
			error={error}
			onEmailChange={setEmail}
			onPasswordChange={setPassword}
			onSignIn={() => handleAuth("in")}
			onCreateAccount={() => handleAuth("up")}
		/>
	);

	// Embedded mode: render just the body for stacking under another panel
	// (e.g. as the optional "cloud sync" section beneath the BYOK keys), with
	// no full-height layout, no panel background, and no duplicate header.
	if (embedded) {
		return <div className="text-foreground">{body}</div>;
	}

	return (
		<div className="flex h-full flex-col bg-[hsl(var(--editor-panel))] text-foreground">
			{/* Header */}
			<div className="flex items-center gap-2.5 px-4 pt-4 pb-3">
				<span
					className="flex h-8 w-8 items-center justify-center rounded-lg"
					style={{
						background: `linear-gradient(135deg, ${ACCENT}33, ${ACCENT}11)`,
						boxShadow: `0 0 18px ${GLOW}22`,
					}}
				>
					<UserCircle weight="fill" className="h-5 w-5" style={{ color: ACCENT }} />
				</span>
				<div className="flex flex-col">
					<span className="text-sm font-semibold leading-tight">Account</span>
					<span className="text-[11px] leading-tight text-muted-foreground">
						Glasscast Cloud
					</span>
				</div>
			</div>

			<div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-4 pb-4">{body}</div>
		</div>
	);
}

function GlassCard({ children }: { children: React.ReactNode }) {
	return (
		<div
			className="rounded-xl border p-4"
			style={{
				background: "hsl(var(--editor-surface))",
				borderColor: `${ACCENT}22`,
				boxShadow: `inset 0 1px 0 ${GLOW}14, 0 8px 24px -16px ${ACCENT}55`,
			}}
		>
			{children}
		</div>
	);
}

function SignedOut(props: {
	email: string;
	password: string;
	busy: boolean;
	error: string | null;
	onEmailChange: (v: string) => void;
	onPasswordChange: (v: string) => void;
	onSignIn: () => void;
	onCreateAccount: () => void;
}) {
	const { email, password, busy, error, onEmailChange, onPasswordChange, onSignIn, onCreateAccount } =
		props;

	return (
		<div className="flex flex-col gap-4 pt-1">
			<GlassCard>
				<form
					className="flex flex-col gap-3"
					onSubmit={(e) => {
						e.preventDefault();
						onSignIn();
					}}
				>
					<div className="flex flex-col gap-1.5">
						<label
							htmlFor="cloud-email"
							className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
						>
							Email
						</label>
						<Input
							id="cloud-email"
							type="email"
							autoComplete="email"
							placeholder="you@example.com"
							value={email}
							disabled={busy}
							onChange={(e) => onEmailChange(e.target.value)}
							className="h-9 bg-[hsl(var(--editor-dialog))]"
						/>
					</div>
					<div className="flex flex-col gap-1.5">
						<label
							htmlFor="cloud-password"
							className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
						>
							Password
						</label>
						<Input
							id="cloud-password"
							type="password"
							autoComplete="current-password"
							placeholder="••••••••"
							value={password}
							disabled={busy}
							onChange={(e) => onPasswordChange(e.target.value)}
							className="h-9 bg-[hsl(var(--editor-dialog))]"
						/>
					</div>

					{error ? (
						<p className="text-[12px] leading-snug text-[#ff3b5c]">{error}</p>
					) : null}

					<Button
						type="submit"
						disabled={busy}
						className="h-9 w-full border-0 font-medium text-white"
						style={{
							background: `linear-gradient(135deg, ${ACCENT}, #4860e6)`,
							boxShadow: `0 6px 18px -8px ${ACCENT}cc`,
						}}
					>
						{busy ? "Signing in…" : "Sign in"}
					</Button>
					<Button
						type="button"
						variant="ghost"
						disabled={busy}
						onClick={onCreateAccount}
						className="h-9 w-full"
						style={{ color: ACCENT }}
					>
						Create account
					</Button>
				</form>
			</GlassCard>

			<p className="px-1 text-[12px] leading-relaxed text-muted-foreground">
				Syncs your settings, presets and AI keys to every device.
			</p>
		</div>
	);
}

function SignedIn(props: {
	status: ReturnType<typeof useCloud>["status"];
	busy: boolean;
	onSyncNow: () => void;
	onSignOut: () => void;
}) {
	const { status, busy, onSyncNow, onSignOut } = props;

	return (
		<div className="flex flex-col gap-4 pt-1">
			<GlassCard>
				<div className="flex items-center gap-3">
					<span
						className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full"
						style={{
							background: `linear-gradient(135deg, ${ACCENT}, #4860e6)`,
							boxShadow: `0 0 16px ${GLOW}33`,
						}}
					>
						<CloudCheck weight="fill" className="h-5 w-5 text-white" />
					</span>
					<div className="flex min-w-0 flex-col">
						<span className="truncate text-sm font-medium" title={status.email ?? ""}>
							{status.email ?? "Signed in"}
						</span>
						<span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
							{status.syncing ? (
								<>
									<ArrowsClockwise className="h-3 w-3 animate-spin" />
									Syncing…
								</>
							) : (
								<>Last synced {formatLastSynced(status.lastSyncAt)}</>
							)}
						</span>
					</div>
				</div>

				{status.lastError ? (
					<p className="mt-3 text-[12px] leading-snug text-[#ff3b5c]">
						{status.lastError}
					</p>
				) : null}
			</GlassCard>

			<div className="flex flex-col gap-2">
				<Button
					type="button"
					disabled={busy || status.syncing}
					onClick={onSyncNow}
					className="h-9 w-full border-0 font-medium text-white"
					style={{
						background: `linear-gradient(135deg, ${ACCENT}, #4860e6)`,
						boxShadow: `0 6px 18px -8px ${ACCENT}cc`,
					}}
				>
					<ArrowsClockwise
						className={`mr-1.5 h-4 w-4 ${status.syncing ? "animate-spin" : ""}`}
					/>
					Sync now
				</Button>
				<Button
					type="button"
					variant="ghost"
					disabled={busy}
					onClick={onSignOut}
					className="h-9 w-full text-muted-foreground hover:text-foreground"
				>
					<SignOut className="mr-1.5 h-4 w-4" />
					Sign out
				</Button>
			</div>

			<p className="px-1 text-[12px] leading-relaxed text-muted-foreground">
				Your settings, presets and AI keys stay in sync across every device.
			</p>
		</div>
	);
}
