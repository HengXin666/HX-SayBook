import { create } from 'zustand';
import { chapterApi, emotionApi, lineApi, llmProviderApi, projectApi, promptApi, roleApi, strengthApi, ttsProviderApi, voiceApi } from '../api';
import type { Chapter, Emotion, Line, LLMProvider, Project, Prompt, Role, Strength, TTSProvider, Voice } from '../types';

interface AppState {
  // 数据
  projects: Project[];
  currentProject: Project | null;
  chapters: Chapter[];
  currentChapter: Chapter | null;
  lines: Line[];
  roles: Role[];
  voices: Voice[];
  emotions: Emotion[];
  strengths: Strength[];
  llmProviders: LLMProvider[];
  ttsProviders: TTSProvider[];
  prompts: Prompt[];

  // 加载状态
  loading: boolean;

  // 日志
  logs: string[];
  addLog: (log: string) => void;
  clearLogs: () => void;

  // Actions
  fetchProjects: () => Promise<void>;
  setCurrentProject: (project: Project | null) => void;
  fetchChapters: (projectId: number) => Promise<void>;
  setCurrentChapter: (chapter: Chapter | null) => void;
  fetchLines: (chapterId: number) => Promise<void>;
  fetchRoles: (projectId: number) => Promise<void>;
  fetchVoices: (ttsProviderId?: number) => Promise<void>;
  fetchEmotions: () => Promise<void>;
  fetchStrengths: () => Promise<void>;
  fetchLLMProviders: () => Promise<void>;
  fetchTTSProviders: () => Promise<void>;
  fetchPrompts: () => Promise<void>;
  setLoading: (loading: boolean) => void;

  // 更新单条line状态
  updateLineStatus: (lineId: number, status: Line['status'], audioPath?: string) => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  projects: [],
  currentProject: null,
  chapters: [],
  currentChapter: null,
  lines: [],
  roles: [],
  voices: [],
  emotions: [],
  strengths: [],
  llmProviders: [],
  ttsProviders: [],
  prompts: [],
  loading: false,
  logs: [],

  addLog: (log) => set((state) => ({ logs: [...state.logs.slice(-200), `[${new Date().toLocaleTimeString()}] ${log}`] })),
  clearLogs: () => set({ logs: [] }),

  fetchProjects: async () => {
    const res = await projectApi.getAll();
    if (res.code === 200 && res.data) set({ projects: res.data });
  },

  setCurrentProject: (project) => set({ currentProject: project }),

  fetchChapters: async (projectId) => {
    const res = await chapterApi.getByProject(projectId);
    if (res.data) set({ chapters: res.data });
    else set({ chapters: [] });
  },

  setCurrentChapter: (chapter) => set({ currentChapter: chapter }),

  fetchLines: async (chapterId) => {
    const res = await lineApi.getByChapter(chapterId);
    if (res.data) set({ lines: res.data });
    else set({ lines: [] });
  },

  fetchRoles: async (projectId) => {
    const res = await roleApi.getByProject(projectId);
    if (res.data) set({ roles: res.data });
    else set({ roles: [] });
  },

  fetchVoices: async (ttsProviderId) => {
    const res = await voiceApi.getAll(ttsProviderId);
    if (res.data) set({ voices: res.data });
    else set({ voices: [] });
  },

  fetchEmotions: async () => {
    const res = await emotionApi.getAll();
    if (res.data) set({ emotions: res.data });
  },

  fetchStrengths: async () => {
    const res = await strengthApi.getAll();
    if (res.data) set({ strengths: res.data });
  },

  fetchLLMProviders: async () => {
    const res = await llmProviderApi.getAll();
    if (res.data) set({ llmProviders: res.data });
  },

  fetchTTSProviders: async () => {
    const res = await ttsProviderApi.getAll();
    if (res.data) set({ ttsProviders: res.data });
  },

  fetchPrompts: async () => {
    const res = await promptApi.getAll();
    if (res.data) set({ prompts: res.data });
  },

  setLoading: (loading) => set({ loading }),

  updateLineStatus: (lineId, status, audioPath) => {
    set((state) => ({
      lines: state.lines.map((l) =>
        l.id === lineId ? { ...l, status, ...(audioPath ? { audio_path: audioPath } : {}) } : l,
      ),
    }));
  },
}));
