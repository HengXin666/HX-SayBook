import type { AutopilotRequest, AutopilotStatus, BatchLLMRequest, BatchTTSRequest, Chapter, ChapterBrief, ChapterPageResponse, Emotion, Line, LLMProvider, Project, Prompt, Res, Role, RoleWithLineCount, Strength, TTSProvider, Voice, VoiceDebugRequest } from '../types';
import api, { API_BASE } from './client';

// ============================================================
// 项目
// ============================================================
export const projectApi = {
  getAll: () => api.get<unknown, Res<Project[]>>('/projects'),
  get: (id: number) => api.get<unknown, Res<Project>>(`/projects/${id}`),
  create: (data: Partial<Project>) => api.post<unknown, Res<Project>>('/projects', data),
  update: (id: number, data: Partial<Project>) => api.put<unknown, Res<Project>>(`/projects/${id}`, data),
  delete: (id: number) => api.delete<unknown, Res>(`/projects/${id}`),
  importChapters: (projectId: number, data: { id: number; content: string }) => api.post<unknown, Res>(`/projects/${projectId}/import`, data),
};

// ============================================================
// 章节
// ============================================================
export const chapterApi = {
  getByProject: (projectId: number) => api.get<unknown, Res<ChapterBrief[]>>(`/chapters/project/${projectId}`),
  getPage: (projectId: number, params: { page?: number; page_size?: number; keyword?: string }) =>
    api.get<unknown, Res<ChapterPageResponse>>(`/chapters/project/${projectId}/page`, { params }),
  getPosition: (projectId: number, chapterId: number, pageSize = 50) =>
    api.get<unknown, Res<{ position: number; page: number }>>(`/chapters/project/${projectId}/position/${chapterId}`, { params: { page_size: pageSize } }),
  getIdsByRange: (projectId: number, params: { start: number; end: number; has_content_only?: boolean }) =>
    api.get<unknown, Res<number[]>>(`/chapters/project/${projectId}/ids-by-range`, { params }),
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
  getByChapter: (chapterId: number) => api.get<unknown, Res<Line[]>>(`/lines/lines/${chapterId}`),
  get: (id: number) => api.get<unknown, Res<Line>>(`/lines/${id}`),
  create: (projectId: number, data: Partial<Line>) => api.post<unknown, Res<Line>>(`/lines/${projectId}`, data),
  update: (id: number, data: Partial<Line>) => api.put<unknown, Res>(`/lines/${id}`, data),
  delete: (id: number) => api.delete<unknown, Res>(`/lines/${id}`),
  deleteAll: (chapterId: number) => api.delete<unknown, Res>(`/lines/lines/${chapterId}`),
  reorder: (orders: { id: number; line_order: number }[]) => api.put<unknown, Res<boolean>>('/lines/batch/orders', orders),
  generateAudio: (projectId: number, chapterId: number, data: Partial<Line>) => api.post<unknown, Res>(`/lines/generate-audio/${projectId}/${chapterId}`, data),
  processAudio: (lineId: number, data: { speed?: number; volume?: number; start_ms?: number | null; end_ms?: number | null; silence_sec?: number; current_ms?: number | null }) => api.post<unknown, Res>(`/lines/process-audio/${lineId}`, data),
  updateAudioPath: (lineId: number, data: { chapter_id: number; audio_path: string }) => api.put<unknown, Res<boolean>>(`/lines/${lineId}/audio_path`, data),
  exportAudio: (chapterId: number, single?: boolean) => api.get<unknown, Res>(`/lines/export-audio/${chapterId}`, { params: { single } }),
  correctSubtitle: (chapterId: number) => api.post<unknown, Res>(`/lines/correct-subtitle/${chapterId}`),
  mergeExport: (data: { project_id: number; chapter_ids: number[]; group_size: number; max_duration_minutes: number }) => api.post<unknown, Res>('/lines/merge-export', data),
  /** 单章节一键导出（音频MP3 + SRT/ASS字幕） */
  exportChapter: (chapterId: number) => api.get<unknown, Res>(`/lines/export-chapter/${chapterId}`),
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
  /** 随机分配路人语音池中的音色给未绑定的角色 */
  assignPasserbyVoices: (projectId: number) => api.post<unknown, Res>(`/roles/project/${projectId}/assign-passerby-voices`),
  /** 获取角色列表（按对话次数降序排列） */
  getSortedByLines: (projectId: number) => api.get<unknown, Res<RoleWithLineCount[]>>(`/roles/project/${projectId}/sorted-by-lines`),
};

// ============================================================
// 音色
// ============================================================
export const voiceApi = {
  getAll: (ttsProviderId?: number) => api.get<unknown, Res<Voice[]>>('/voices', { params: { tts_provider_id: ttsProviderId } }),
  get: (id: number) => api.get<unknown, Res<Voice>>(`/voices/${id}`),
  create: (data: Partial<Voice>) => api.post<unknown, Res<Voice>>('/voices', data),
  update: (id: number, data: Partial<Voice>) => api.put<unknown, Res>(`/voices/${id}`, data),
  delete: (id: number) => api.delete<unknown, Res>(`/voices/${id}`),
  /** 上传音色（含参考音频文件） */
  upload: (data: FormData) => api.post<unknown, Res<Voice>>('/voices/upload', data, { headers: { 'Content-Type': 'multipart/form-data' } }),
  /** 获取音频文件URL */
  getAudioUrl: (path: string) => `${API_BASE}/voices/audio-file?path=${encodeURIComponent(path)}`,
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
  getAll: () => api.get<unknown, Res<LLMProvider[]>>('/llm_providers'),
  get: (id: number) => api.get<unknown, Res<LLMProvider>>(`/llm_providers/${id}`),
  create: (data: Partial<LLMProvider>) => api.post<unknown, Res<LLMProvider>>('/llm_providers', data),
  update: (id: number, data: Partial<LLMProvider>) => api.put<unknown, Res>(`/llm_providers/${id}`, data),
  delete: (id: number) => api.delete<unknown, Res>(`/llm_providers/${id}`),
  test: (data: Partial<LLMProvider>) => api.post<unknown, Res>('/llm_providers/test', data),
};

// ============================================================
// TTS 提供商
// ============================================================
export const ttsProviderApi = {
  getAll: () => api.get<unknown, Res<TTSProvider[]>>('/tts_providers'),
  get: (id: number) => api.get<unknown, Res<TTSProvider>>(`/tts_providers/${id}`),
  create: (data: Partial<TTSProvider>) => api.post<unknown, Res<TTSProvider>>('/tts_providers', data),
  update: (id: number, data: Partial<TTSProvider>) => api.put<unknown, Res>(`/tts_providers/${id}`, data),
  delete: (id: number) => api.delete<unknown, Res>(`/tts_providers/${id}`),
  test: (data: Partial<TTSProvider>) => api.post<unknown, Res>('/tts_providers/test', data),
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
  llmCancel: (projectId: number) => api.post<unknown, Res>('/batch/llm-cancel', null, { params: { project_id: projectId } }),
  llmStatus: (projectId: number) => api.get<unknown, Res<{ running: boolean; cancelled: boolean }>>('/batch/llm-status', { params: { project_id: projectId } }),
  ttsGenerate: (data: BatchTTSRequest) => api.post<unknown, Res>('/batch/tts-generate', data),
  ttsCancel: (projectId: number) => api.post<unknown, Res>('/batch/tts-cancel', null, { params: { project_id: projectId } }),
  ttsStatus: (projectId: number) => api.get<unknown, Res<{ running: boolean; cancelled: boolean }>>('/batch/tts-status', { params: { project_id: projectId } }),
  voicePreview: (data: VoiceDebugRequest) => api.post<unknown, Res<{ audio_url: string }>>('/batch/voice-preview', data),
  voiceDebug: (data: VoiceDebugRequest) => api.post<unknown, Res<{ audio_url: string; voice_name: string; emotion: string; strength: string; speed: number }>>('/batch/voice-debug', data),
  adjustSpeed: (lineId: number, speed: number) => api.post<unknown, Res>('/batch/adjust-speed', { line_id: lineId, speed }),
  batchAdjustSpeed: (chapterId: number, speed: number) => api.post<unknown, Res>('/batch/batch-adjust-speed', { chapter_id: chapterId, speed }),
  /** 一键挂机 */
  autopilotStart: (data: AutopilotRequest) => api.post<unknown, Res>('/batch/autopilot-start', data),
  autopilotStatus: (projectId: number) => api.get<unknown, Res<AutopilotStatus>>('/batch/autopilot-status', { params: { project_id: projectId } }),
  autopilotPause: (projectId: number) => api.post<unknown, Res>('/batch/autopilot-pause', null, { params: { project_id: projectId } }),
  autopilotResume: (projectId: number) => api.post<unknown, Res>('/batch/autopilot-resume', null, { params: { project_id: projectId } }),
  autopilotCancel: (projectId: number) => api.post<unknown, Res>('/batch/autopilot-cancel', null, { params: { project_id: projectId } }),
};
