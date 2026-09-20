import { create } from "zustand";
import type { Plan } from "@/types/database";

interface AuthState {
	user: { id: string; email: string } | null;
	plan: Plan;
	isLoading: boolean;
	setUser: (user: { id: string; email: string } | null) => void;
	setPlan: (plan: Plan) => void;
	setLoading: (loading: boolean) => void;
	reset: () => void;
}

const initialState = {
	user: null,
	plan: "free" as Plan,
	isLoading: true,
};

export const useAuthStore = create<AuthState>((set) => ({
	...initialState,
	setUser: (user) => set({ user }),
	setPlan: (plan) => set({ plan }),
	setLoading: (isLoading) => set({ isLoading }),
	reset: () => set(initialState),
}));

interface ChatMessage {
	id: string;
	role: "user" | "assistant" | "system";
	content: string;
	timestamp: number;
}

interface ChatState {
	messages: ChatMessage[];
	isStreaming: boolean;
	isGeneratingPRD: boolean;
	isGeneratingAC: boolean;
	isTaskGenerated: boolean;
	generationStep: number;
	selectedMode: "ai_auto" | "manual" | null;
	activeProjectId: string | null;
	streamingPRDContent: string;
	completedSections: string[];
	creditsExhausted: { stage: "prd" | "ac" | "task"; message: string } | null;
	addMessage: (message: ChatMessage) => void;
	setStreaming: (streaming: boolean) => void;
	setGeneratingPRD: (generating: boolean) => void;
	setGeneratingAC: (generating: boolean) => void;
	setTaskGenerated: (generated: boolean) => void;
	setGenerationStep: (step: number) => void;
	setSelectedMode: (mode: "ai_auto" | "manual" | null) => void;
	setActiveProject: (projectId: string | null) => void;
	setStreamingPRDContent: (content: string) => void;
	updateLastMessage: (content: string) => void;
	setMessages: (messages: ChatMessage[]) => void;
	setCompletedSections: (sections: string[]) => void;
	setCreditsExhausted: (v: ChatState["creditsExhausted"]) => void;
	resetChat: () => void;
}

const chatInitialState = {
	messages: [],
	isStreaming: false,
	isGeneratingPRD: false,
	isGeneratingAC: false,
	isTaskGenerated: false,
	generationStep: 0,
	selectedMode: null as "ai_auto" | "manual" | null,
	activeProjectId: null as string | null,
	streamingPRDContent: "",
	completedSections: [] as string[],
	creditsExhausted: null as ChatState["creditsExhausted"],
};

export const useChatStore = create<ChatState>((set) => ({
	...chatInitialState,
	addMessage: (message) =>
		set((state) => ({ messages: [...state.messages, message] })),
	setStreaming: (isStreaming) => set({ isStreaming }),
	setGeneratingPRD: (isGeneratingPRD) => set({ isGeneratingPRD }),
	setGeneratingAC: (isGeneratingAC) => set({ isGeneratingAC }),
	setTaskGenerated: (isTaskGenerated) => set({ isTaskGenerated }),
	setGenerationStep: (generationStep) => set({ generationStep }),
	setCompletedSections: (completedSections) => set({ completedSections }),
	setCreditsExhausted: (creditsExhausted) => set({ creditsExhausted }),
	setSelectedMode: (selectedMode) => set({ selectedMode }),
	setActiveProject: (activeProjectId) => set({ activeProjectId }),
	setStreamingPRDContent: (streamingPRDContent) => set({ streamingPRDContent }),
	updateLastMessage: (content) =>
		set((state) => {
			const messages = [...state.messages];
			if (messages.length > 0) {
				messages[messages.length - 1] = {
					...messages[messages.length - 1],
					content,
				};
			}
			return { messages };
		}),
	setMessages: (messages) => set({ messages }),
	resetChat: () => set(chatInitialState),
}));

interface UIState {
	isChatPanelOpen: boolean;
	isPRDLoading: boolean;
	toastMessage: string | null;
	toastType: "success" | "error" | "info" | null;
	isProjectDrawerOpen: boolean;
	activeReviewModal: "prd" | "ac" | null;
	toggleChatPanel: () => void;
	setPRDLoading: (loading: boolean) => void;
	showToast: (message: string, type: "success" | "error" | "info") => void;
	hideToast: () => void;
	setProjectDrawerOpen: (open: boolean) => void;
	setActiveReviewModal: (modal: "prd" | "ac" | null) => void;
}

export const useUIStore = create<UIState>((set) => ({
	isChatPanelOpen: true,
	isPRDLoading: false,
	toastMessage: null,
	toastType: null,
	isProjectDrawerOpen: false,
	activeReviewModal: null,
	toggleChatPanel: () =>
		set((state) => ({ isChatPanelOpen: !state.isChatPanelOpen })),
	setPRDLoading: (loading) => set({ isPRDLoading: loading }),
	showToast: (message, type) => set({ toastMessage: message, toastType: type }),
	hideToast: () => set({ toastMessage: null, toastType: null }),
	setProjectDrawerOpen: (isProjectDrawerOpen) => set({ isProjectDrawerOpen }),
	setActiveReviewModal: (activeReviewModal) => set({ activeReviewModal }),
}));
