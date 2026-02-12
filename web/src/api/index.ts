import type { BatchLLMRequest, BatchTTSRequest, Chapter, Emotion, Line, LLMProvider, Project, Prompt, Res, Role, Strength, TTSProvider, Voice, VoiceDebugRequest } from '../types';
import api from './client';

// ============================================================
// 项目
// ============================================================
export const projectApi = {
  getAll: () => api.get<unknown, Res<Project[]>>('/projects'),
  get: (id: number) => api.get<unknown, Res<Project>>(`/projects/${id}`),
  create: (data: Partial<Project>) => api.post<unknown, Res<Project>>('/projects', data),
  update: (id: number, data: Partial<Project>) => api.put<unknown, Res<Project>>(`/projects/${id}`, data),
  delete: (id: number) => api.delete<unknown, Res>(`/projects/${id}`),
};

// ============================================================
// 章节
// ============================================================
export const chapterApi = {
  getByProject: (projectId: number) => api.get<unknown, Res<Chapter[]>>(`/chapters/project/${projectId}`),
  get: (id: number) => api.get<unknown, Res<Chapter>>(`/chapters/${id}`),
  create: (data: Partial<Chapter>) => api.post<unknown, Res<Chapter>>('/chapters', data),
  update: (id: number, data: Partial<Chapter>) => api.put<unknown, Res<Chapter>>(`/chapters/${id}`, data),
  delete: (id: number) => api.delete<unknown, Res>(`/chapters/${id}`),
  getLines: (projectId: number, chapterId: number) => api.get<unknown, Res<string>>(`/chapters/get-lines/${projectId}/${chapterId}`),
  exportPrompt: (projectId: number, chapterId: number) => api.get<unknown, Res<string>>(`/chapters/export-llm-prompt/${projectId}/${chapterId}`),
  importLines: (projectId: number, chapterId: number, data: string) => {
    const formData = new FormData();
    formData.append('data', data);
    return api.post<unknown, Res>(`/chapters/import-lines/${projectId}/${chapterId}`, formData);
  },
  smartMatch: (projectId: number, chapterId: number) => api.post<unknown, Res<unknown[]>>(`/chapters/add-smart-role-and-voice/${projectId}/${chapterId}`),
};

// ============================================================
// 台词
// ============================================================
export const lineApi = {
  getByChapter: (chapterId: number) => api.get<unknown, Res<Line[]>>(`/lines/chapter/${chapterId}`),
  get: (id: number) => api.get<unknown, Res<Line>>(`/lines/${id}`),
  update: (id: number, data: Partial<Line>) => api.put<unknown, Res>(`/lines/${id}`, data),
  delete: (id: number) => api.delete<unknown, Res>(`/lines/${id}`),
  deleteAll: (chapterId: number) => api.delete<unknown, Res>(`/lines/chapter/${chapterId}`),
  exportAudio: (chapterId: number, single?: boolean) => api.get<unknown, Res>(`/lines/export/${chapterId}`, { params: { single } }),
};

// ============================================================
// 角色
// ============================================================
export const roleApi = {
  getByProject: (projectId: number) => api.get<unknown, Res<Role[]>>(`/roles/project/${projectId}`),
  get: (id: number) => api.get<unknown, Res<Role>>(`/roles/${id}`),
  create: (data: Partial<Role>) => api.post<unknown, Res<Role>>('/roles', data),
  update: (id: number, data: Partial<Role>) => api.put<unknown, Res>(`/roles/${id}`, data),
  delete: (id: number) => api.delete<unknown, Res>(`/roles/${id}`),
};

// ============================================================
// 音色
// ============================================================
export const voiceApi = {
  getAll: (ttsProviderId?: number) => api.get<unknown, Res<Voice[]>>('/voices', { params: { tts_provider_id: ttsProviderId } }),
  get: (id: number) => api.get<unknown, Res<Voice>>(`/voices/${id}`),
  create: (data: FormData) => api.post<unknown, Res<Voice>>('/voices', data, { headers: { 'Content-Type': 'multipart/form-data' } }),
  update: (id: number, data: Partial<Voice>) => api.put<unknown, Res>(`/voices/${id}`, data),
  delete: (id: number) => api.delete<unknown, Res>(`/voices/${id}`),
};

// ============================================================
// 情绪 & 强度
// ============================================================
export const emotionApi = {
  getAll: () => api.get<unknown, Res<Emotion[]>>('/emotions'),
};

export const strengthApi = {
  getAll: () => api.get<unknown, Res<Strength[]>>('/strengths'),
};

// ============================================================
// LLM 提供商
// ============================================================
export const llmProviderApi = {
  getAll: () => api.get<unknown, Res<LLMProvider[]>>('/llm-providers'),
  get: (id: number) => api.get<unknown, Res<LLMProvider>>(`/llm-providers/${id}`),
  create: (data: Partial<LLMProvider>) => api.post<unknown, Res<LLMProvider>>('/llm-providers', data),
  update: (id: number, data: Partial<LLMProvider>) => api.put<unknown, Res>(`/llm-providers/${id}`, data),
  delete: (id: number) => api.delete<unknown, Res>(`/llm-providers/${id}`),
};

// ============================================================
// TTS 提供商
// ============================================================
export const ttsProviderApi = {
  getAll: () => api.get<unknown, Res<TTSProvider[]>>('/tts-providers'),
  get: (id: number) => api.get<unknown, Res<TTSProvider>>(`/tts-providers/${id}`),
  create: (data: Partial<TTSProvider>) => api.post<unknown, Res<TTSProvider>>('/tts-providers', data),
  update: (id: number, data: Partial<TTSProvider>) => api.put<unknown, Res>(`/tts-providers/${id}`, data),
  delete: (id: number) => api.delete<unknown, Res>(`/tts-providers/${id}`),
};

// ============================================================
// 提示词
// ============================================================
export const promptApi = {
  getAll: () => api.get<unknown, Res<Prompt[]>>('/prompts'),
  get: (id: number) => api.get<unknown, Res<Prompt>>(`/prompts/${id}`),
  create: (data: Partial<Prompt>) => api.post<unknown, Res<Prompt>>('/prompts', data),
  update: (id: number, data: Partial<Prompt>) => api.put<unknown, Res>(`/prompts/${id}`, data),
  delete: (id: number) => api.delete<unknown, Res>(`/prompts/${id}`),
};

// ============================================================
// 批量处理
// ============================================================
export const batchApi = {
  llmParse: (data: BatchLLMRequest) => api.post<unknown, Res>('/batch/llm-parse', data),
  ttsGenerate: (data: BatchTTSRequest) => api.post<unknown, Res>('/batch/tts-generate', data),
  voicePreview: (data: VoiceDebugRequest) => api.post<unknown, Res<{ audio_url: string }>>('/batch/voice-preview', data),
  voiceDebug: (data: VoiceDebugRequest) => api.post<unknown, Res<{ audio_url: string; voice_name: string; emotion: string; strength: string; speed: number }>>('/batch/voice-debug', data),
  adjustSpeed: (lineId: number, speed: number) => api.post<unknown, Res>('/batch/adjust-speed', { line_id: lineId, speed }),
  batchAdjustSpeed: (chapterId: number, speed: number) => api.post<unknown, Res>('/batch/batch-adjust-speed', { chapter_id: chapterId, speed }),
};
