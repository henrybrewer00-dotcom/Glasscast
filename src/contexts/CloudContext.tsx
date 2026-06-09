import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";

export interface CloudStatus {
	signedIn: boolean;
	email: string | null;
	userId: string | null;
	lastSyncAt: number | null;
	syncing: boolean;
	lastError: string | null;
}

interface CloudActionResult {
	success: boolean;
	error?: string;
}

interface CloudContextValue {
	status: CloudStatus;
	/** True until the first status snapshot has loaded from the main process. */
	ready: boolean;
	signIn: (email: string, password: string) => Promise<CloudActionResult>;
	signUp: (email: string, password: string) => Promise<CloudActionResult>;
	signOut: () => Promise<void>;
	syncNow: () => Promise<CloudActionResult>;
}

const DEFAULT_STATUS: CloudStatus = {
	signedIn: false,
	email: null,
	userId: null,
	lastSyncAt: null,
	syncing: false,
	lastError: null,
};

const CloudContext = createContext<CloudContextValue | null>(null);

type CloudBridge = NonNullable<Window["electronAPI"]> | undefined;

function getBridge(): CloudBridge {
	if (typeof window === "undefined") return undefined;
	return window.electronAPI;
}

export function CloudProvider({ children }: { children: React.ReactNode }) {
	const [status, setStatus] = useState<CloudStatus>(DEFAULT_STATUS);
	const [ready, setReady] = useState(false);
	const mountedRef = useRef(true);

	useEffect(() => {
		mountedRef.current = true;
		return () => {
			mountedRef.current = false;
		};
	}, []);

	// Initial status load + live subscription to status changes.
	useEffect(() => {
		const bridge = getBridge();
		if (!bridge?.cloudGetStatus) {
			setReady(true);
			return;
		}

		let unsubscribe: (() => void) | undefined;

		bridge
			.cloudGetStatus()
			.then((res) => {
				if (!mountedRef.current) return;
				if (res?.success && res.status) {
					setStatus(res.status);
				}
			})
			.catch(() => undefined)
			.finally(() => {
				if (mountedRef.current) setReady(true);
			});

		if (bridge.onCloudStatusChanged) {
			unsubscribe = bridge.onCloudStatusChanged((next) => {
				if (mountedRef.current) setStatus(next);
			});
		}

		return () => {
			unsubscribe?.();
		};
	}, []);

	const signIn = useCallback(async (email: string, password: string): Promise<CloudActionResult> => {
		const bridge = getBridge();
		if (!bridge?.cloudSignIn) return { success: false, error: "Cloud sync is unavailable." };
		try {
			const res = await bridge.cloudSignIn(email, password);
			if (res?.success && res.status) setStatus(res.status);
			return { success: !!res?.success, error: res?.error };
		} catch (error) {
			return { success: false, error: String((error as Error)?.message ?? error) };
		}
	}, []);

	const signUp = useCallback(async (email: string, password: string): Promise<CloudActionResult> => {
		const bridge = getBridge();
		if (!bridge?.cloudSignUp) return { success: false, error: "Cloud sync is unavailable." };
		try {
			const res = await bridge.cloudSignUp(email, password);
			if (res?.success && res.status) setStatus(res.status);
			return { success: !!res?.success, error: res?.error };
		} catch (error) {
			return { success: false, error: String((error as Error)?.message ?? error) };
		}
	}, []);

	const signOut = useCallback(async (): Promise<void> => {
		const bridge = getBridge();
		if (!bridge?.cloudSignOut) return;
		try {
			const res = await bridge.cloudSignOut();
			if (res?.status) setStatus(res.status);
		} catch {
			// ignore — local sign-out best effort
		}
	}, []);

	const syncNow = useCallback(async (): Promise<CloudActionResult> => {
		const bridge = getBridge();
		if (!bridge?.cloudSyncNow) return { success: false, error: "Cloud sync is unavailable." };
		try {
			const res = await bridge.cloudSyncNow();
			if (res?.success && res.status) setStatus(res.status);
			return { success: !!res?.success, error: res?.error };
		} catch (error) {
			return { success: false, error: String((error as Error)?.message ?? error) };
		}
	}, []);

	const value = useMemo<CloudContextValue>(
		() => ({ status, ready, signIn, signUp, signOut, syncNow }),
		[status, ready, signIn, signUp, signOut, syncNow],
	);

	return <CloudContext.Provider value={value}>{children}</CloudContext.Provider>;
}

export function useCloud(): CloudContextValue {
	const ctx = useContext(CloudContext);
	if (!ctx) {
		throw new Error("useCloud must be used within a CloudProvider");
	}
	return ctx;
}
