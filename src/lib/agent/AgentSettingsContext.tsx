import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";
import {
	type AgentKeyStatus,
	deleteAgentKey,
	getAgentKeyStatuses,
	saveAgentKey,
} from "./agentClient";
import { type AgentPermissionLevel } from "./agentCore";
import { AGENT_PROVIDERS, type AgentProviderId } from "./providers";

/**
 * Shared AI-agent settings so the chat panel ("AI" tab) and the BYOK key panel
 * ("Account" tab) stay in sync without prop-drilling: provider, model, permission
 * level, any user-added custom models, and the encrypted key statuses.
 */
export interface AgentSettingsValue {
	provider: AgentProviderId;
	setProvider: (provider: AgentProviderId) => void;
	model: string;
	setModel: (model: string) => void;
	permission: AgentPermissionLevel;
	setPermission: (permission: AgentPermissionLevel) => void;
	/** User-typed custom model ids (per provider), appended to the picker. */
	customModels: string[];
	addCustomModel: (model: string) => void;
	statuses: AgentKeyStatus[];
	hasKey: (provider: AgentProviderId) => boolean;
	refreshStatuses: () => Promise<void>;
	saveKey: (provider: AgentProviderId, key: string) => Promise<boolean>;
	deleteKey: (provider: AgentProviderId) => Promise<void>;
}

const AgentSettingsContext = createContext<AgentSettingsValue | null>(null);

export function AgentSettingsProvider({ children }: { children: ReactNode }) {
	const [provider, setProvider] = useState<AgentProviderId>("anthropic");
	const [model, setModel] = useState<string>(AGENT_PROVIDERS.anthropic.defaultModel);
	const [permission, setPermission] = useState<AgentPermissionLevel>("assist");
	const [customModelsByProvider, setCustomModelsByProvider] = useState<Record<string, string[]>>(
		{},
	);
	const [statuses, setStatuses] = useState<AgentKeyStatus[]>([]);

	const refreshStatuses = useCallback(async () => {
		setStatuses(await getAgentKeyStatuses());
	}, []);

	useEffect(() => {
		void refreshStatuses();
	}, [refreshStatuses]);

	// When the provider changes, snap the model to that provider's default.
	useEffect(() => {
		setModel(AGENT_PROVIDERS[provider].defaultModel);
	}, [provider]);

	const addCustomModel = useCallback(
		(rawModel: string) => {
			const next = rawModel.trim();
			if (!next) return;
			setCustomModelsByProvider((prev) => {
				const existing = prev[provider] ?? [];
				if (existing.includes(next) || AGENT_PROVIDERS[provider].models.includes(next)) {
					return prev;
				}
				return { ...prev, [provider]: [...existing, next] };
			});
			setModel(next);
		},
		[provider],
	);

	const hasKey = useCallback(
		(target: AgentProviderId) => statuses.find((s) => s.provider === target)?.hasKey ?? false,
		[statuses],
	);

	const saveKey = useCallback(
		async (target: AgentProviderId, key: string) => {
			const ok = await saveAgentKey(target, key);
			if (ok) await refreshStatuses();
			return ok;
		},
		[refreshStatuses],
	);

	const deleteKey = useCallback(
		async (target: AgentProviderId) => {
			await deleteAgentKey(target);
			await refreshStatuses();
		},
		[refreshStatuses],
	);

	const value = useMemo<AgentSettingsValue>(
		() => ({
			provider,
			setProvider,
			model,
			setModel,
			permission,
			setPermission,
			customModels: customModelsByProvider[provider] ?? [],
			addCustomModel,
			statuses,
			hasKey,
			refreshStatuses,
			saveKey,
			deleteKey,
		}),
		[
			provider,
			model,
			permission,
			customModelsByProvider,
			addCustomModel,
			statuses,
			hasKey,
			refreshStatuses,
			saveKey,
			deleteKey,
		],
	);

	return <AgentSettingsContext.Provider value={value}>{children}</AgentSettingsContext.Provider>;
}

export function useAgentSettings(): AgentSettingsValue {
	const ctx = useContext(AgentSettingsContext);
	if (!ctx) {
		throw new Error("useAgentSettings must be used within an AgentSettingsProvider");
	}
	return ctx;
}
