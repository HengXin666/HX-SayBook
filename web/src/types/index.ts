/** 后端统一响应格式 */
export interface Res<T = unknown> {
  code: number;
  message: string;
  data: T | null;
}

/** 项目 */
export interface Project {
  id: number;
  name: string;
  description: string | null;
  llm_provider_id: number | null;
  llm_model: string | null;
  tts_provider_id: number | null;
  prompt_id: number | null;
  is_precise_fill: number;
  project_root_path: string | null;
  passerby_voice_pool: number[] | null;
  language: string | null;
  created_at: string;
  updated_at: string;
}

/** 章节简要信息（不含 text_content） */
export interface ChapterBrief {
  id: number;
  project_id: number;
  title: string;
  order_index: number | null;
  has_content: boolean;
  created_at: string;
  updated_at: string;
}

/** 章节 */
export interface Chapter {
  id: number;
  project_id: number;
  title: string;
  order_index: number | null;
  text_content: string | null;
  created_at: string;
  updated_at: string;
}

/** 章节分页响应 */
export interface ChapterPageResponse {
  items: ChapterBrief[];
  total: number;
  page: number;
  page_size: number;
}

/** 台词 */
export interface Line {
  id: number;
  chapter_id: number;
  role_id: number | null;
  voice_id: number | null;
  line_order: number | null;
  text_content: string | null;
  emotion_id: number | null;
  strength_id: number | null;
  audio_path: string | null;
  subtitle_path: string | null;
  speed: number;
  status: 'pending' | 'processing' | 'done' | 'failed';
  is_done: number;
  created_at: string;
  updated_at: string;
}

/** 角色 */
export interface Role {
  id: number;
  project_id: number;
  name: string;
  default_voice_id: number | null;
  description: string | null;
  created_at: string;
  updated_at: string;
}

/** 角色（含对话次数） */
export interface RoleWithLineCount extends Role {
  line_count: number;
}

/** 音色 */
export interface Voice {
  id: number;
  tts_provider_id: number | null;
  name: string;
  reference_path: string | null;
  description: string | null;
  is_multi_emotion: number;
  created_at: string;
  updated_at: string;
}

/** 情绪 */
export interface Emotion {
  id: number;
  name: string;
  description: string | null;
  is_active: number;
}

/** 情绪强度 */
export interface Strength {
  id: number;
  name: string;
  description: string | null;
  is_active: number;
}

/** LLM 提供商 */
export interface LLMProvider {
  id: number;
  name: string;
  api_base_url: string;
  api_key: string | null;
  model_list: string[] | null;
  status: number;
  custom_params: string | null;
  created_at: string;
  updated_at: string;
}

/** TTS 提供商 */
export interface TTSProvider {
  id: number;
  name: string;
  api_base_url: string;
  api_key: string | null;
  status: number;
  created_at: string;
  updated_at: string;
}

/** 提示词 */
export interface Prompt {
  id: number;
  name: string;
  task: string;
  description: string | null;
  content: string | null;
  created_at: string;
  updated_at: string;
}

/** 多情绪音色 */
export interface MultiEmotionVoice {
  id: number;
  voice_id: number;
  emotion_id: number;
  strength_id: number | null;
  reference_path: string | null;
}

/** WebSocket 事件 */
export interface WSEvent {
  event: string;
  [key: string]: unknown;
}

/** 批量LLM请求 */
export interface BatchLLMRequest {
  project_id: number;
  chapter_ids: number[];
  concurrency?: number;
  /** 是否跳过已解析过的章节（默认 true） */
  skip_parsed?: boolean;
}

/** 批量TTS请求 */
export interface BatchTTSRequest {
  project_id: number;
  chapter_ids: number[];
  speed?: number;
  /** 跳过已配音(status=done且音频文件存在)的台词 */
  skip_done?: boolean;
  /** 仅补配缺失音频（audio_path为空或文件不存在的台词） */
  only_missing?: boolean;
}

/** 语音调试请求 */
export interface VoiceDebugRequest {
  text: string;
  voice_id: number;
  tts_provider_id: number;
  emotion_name?: string;
  strength_name?: string;
  speed?: number;
  language?: string;
}

/** 一键挂机请求 */
export interface AutopilotRequest {
  project_id: number;
  chapter_ids: number[];
  concurrency?: number;
  speed?: number;
  voice_match_interval?: number;
  manual_voice_assign?: boolean;
}

/** 一键挂机状态响应 */
export interface AutopilotStatus {
  running: boolean;
  paused: boolean;
  cancelled: boolean;
}
