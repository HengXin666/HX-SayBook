import {
    ArrowLeftOutlined,
    CloudDownloadOutlined,
    DeleteOutlined,
    DownloadOutlined,
    EditOutlined,
    FileTextOutlined,
    HistoryOutlined,
    LoadingOutlined,
    MergeCellsOutlined,
    PauseCircleOutlined,
    PlusOutlined,
    ReloadOutlined,
    RobotOutlined,
    RocketOutlined,
    SearchOutlined,
    SettingOutlined,
    SoundOutlined,
    ThunderboltOutlined,
    UploadOutlined
} from '@ant-design/icons';
import {
    Avatar,
    Button,
    Card,
    Checkbox,
    Col,
    Divider,
    Empty,
    Form,
    Input,
    InputNumber,
    Layout,
    message,
    Modal,
    Popconfirm,
    Progress,
    Radio,
    Row,
    Select,
    Space,
    Table,
    Tabs,
    Tag,
    Tooltip,
    Typography
} from 'antd';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { chapterApi, emotionApi, lineApi, llmProviderApi, projectApi, promptApi, roleApi, strengthApi, ttsProviderApi, voiceApi } from '../api';
import AudioWaveform from '../components/AudioWaveform';
import AutoPilotModal from '../components/AutoPilotModal';
import BatchLLMModal from '../components/BatchLLMModal';
import BatchTTSModal from '../components/BatchTTSModal';
import SpeedControl from '../components/SpeedControl';
import { useChapterLazyList } from '../hooks/useChapterLazyList';
import { usePersistedConfig } from '../hooks/usePersistedState';
import { useWebSocket } from '../hooks/useWebSocket';
import type { Chapter, ChapterBrief, Emotion, Line, LLMProvider, Project, Prompt, Role, Strength, TTSProvider, Voice, WSEvent } from '../types';

const { Sider, Content } = Layout;
const { Title, Text } = Typography;

export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const projectId = Number(id);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { subscribe } = useWebSocket();

  // ==================== 项目数据 ====================
  const [project, setProject] = useState<Project | null>(null);

  // ==================== 章节数据 ====================
  const [chapters, setChapters] = useState<ChapterBrief[]>([]); // 侧边栏分页列表
  const [chapterTotal, setChapterTotal] = useState(0); // 章节总数
  const [chapterLoading, setChapterLoading] = useState(false); // 加载中
  const [chapterHasMore, setChapterHasMore] = useState(true); // 向下是否还有更多
  const [chapterHasLess, setChapterHasLess] = useState(false); // 向上是否还有更多
  const [chapterOffsetStart, setChapterOffsetStart] = useState(0); // 当前窗口起始偏移
  const CHAPTER_PAGE_SIZE = 50;
  // 从 URL 参数或 localStorage 恢复选中的章节
  const [activeChapterId, setActiveChapterId] = useState<number | null>(() => {
    const chapterParam = searchParams.get('chapter');
    if (chapterParam) return Number(chapterParam);
    // 从 localStorage 恢复
    const saved = localStorage.getItem(`saybook_last_chapter_${id}`);
    return saved ? Number(saved) : null;
  });
  const [currentChapterDetail, setCurrentChapterDetail] = useState<Chapter | null>(null); // 选中章节的完整数据
  const [chapterKeyword, setChapterKeyword] = useState('');
  const [chapterCollapsed, setChapterCollapsed] = useState(true);

  // ==================== 台词数据 ====================
  const [lines, setLines] = useState<Line[]>([]);
  const [lineKeyword, setLineKeyword] = useState('');
  const [roleFilter, setRoleFilter] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('');

  // ==================== 角色数据 ====================
  const [roles, setRoles] = useState<Role[]>([]);
  const [roleKeyword, setRoleKeyword] = useState('');
  const [roleLineCounts, setRoleLineCounts] = useState<Record<number, number>>({});
  const [roleSortByLines, setRoleSortByLines] = useState(false);

  // ==================== 音色数据 ====================
  const [voices, setVoices] = useState<Voice[]>([]);
  const [roleVoiceMap, setRoleVoiceMap] = useState<Record<number, number>>({});

  // ==================== 情绪 & 强度 ====================
  const [emotions, setEmotions] = useState<Emotion[]>([]);
  const [strengths, setStrengths] = useState<Strength[]>([]);

  // 情绪/强度 id->name 映射表，用于在 options 未加载时也能显示中文名
  const emotionMap = useMemo(() => new Map(emotions.map(e => [e.id, e.name])), [emotions]);
  const strengthMap = useMemo(() => new Map(strengths.map(s => [s.id, s.name])), [strengths]);

  // ==================== 配置数据 ====================
  const [llmProviders, setLlmProviders] = useState<LLMProvider[]>([]);
  const [ttsProviders, setTtsProviders] = useState<TTSProvider[]>([]);
  const [prompts, setPrompts] = useState<Prompt[]>([]);

  // ==================== 弹窗状态 ====================
  const [chapterModalOpen, setChapterModalOpen] = useState(false);
  const [chapterModalMode, setChapterModalMode] = useState<'create' | 'rename'>('create');
  const [editingChapter, setEditingChapter] = useState<Chapter | null>(null);
  const [chapterForm] = Form.useForm();

  const [importTextModal, setImportTextModal] = useState(false);
  const [importText, setImportText] = useState('');
  const [editTextModal, setEditTextModal] = useState(false);
  const [editText, setEditText] = useState('');

  const [roleModalOpen, setRoleModalOpen] = useState(false);
  const [roleForm] = Form.useForm();

  const [voiceModalOpen, setVoiceModalOpen] = useState(false);
  const [voiceModalRole, setVoiceModalRole] = useState<Role | null>(null);
  const [voiceSearchName, setVoiceSearchName] = useState('');

  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [settingsForm] = Form.useForm();

  const [importThirdModal, setImportThirdModal] = useState(false);
  const [thirdJsonText, setThirdJsonText] = useState('');

  // ==================== 批量操作弹窗 ====================
  const [batchLLMModalOpen, setBatchLLMModalOpen] = useState(false);
  const [batchTTSModalOpen, setBatchTTSModalOpen] = useState(false);
  const [autoPilotModalOpen, setAutoPilotModalOpen] = useState(false);
  // 批量LLM后台运行状态（弹窗关闭时也能显示进度）
  const [batchLLMRunning, setBatchLLMRunning] = useState(false);
  const [batchLLMProgress, setBatchLLMProgress] = useState(0);
  const [batchLLMCurrent, setBatchLLMCurrent] = useState(0);
  const [batchLLMTotal, setBatchLLMTotal] = useState(0);
  // 一键挂机后台运行状态
  const [autoPilotRunning, setAutoPilotRunning] = useState(false);
  const [autoPilotProgress, setAutoPilotProgress] = useState(0);

  // ==================== 合并导出弹窗 ====================
  const [mergeModalOpen, setMergeModalOpen] = useState(false);
  const [mergeSelectedChapters, setMergeSelectedChapters] = useState<number[]>([]);
  const [mergeMode, setMergeMode] = useState<'all' | 'group' | 'duration'>('all');
  const [mergeGroupSize, setMergeGroupSize] = useState(1);
  const [mergeDurationMinutes, setMergeDurationMinutes] = useState(30);
  const [mergeLoading, setMergeLoading] = useState(false);
  const [mergeResults, setMergeResults] = useState<{ name: string; url: string; chapters: string[]; duration?: string; subtitles?: Record<string, string> }[] | null>(null);
  // 合并导出范围选择（持久化）
  const [mergeRangeConfig, updateMergeRange] = usePersistedConfig(
    `saybook_merge_range_${id}`,
    { rangeStart: 1, rangeEnd: 0 }
  );
  const mergeRangeStart = mergeRangeConfig.rangeStart;
  const setMergeRangeStart = (v: number) => updateMergeRange('rangeStart', v);
  const setMergeRangeEnd = (v: number) => updateMergeRange('rangeEnd', v);
  const [mergeRangeLoading, setMergeRangeLoading] = useState(false);
  const [mergeZipLoading, setMergeZipLoading] = useState(false);
  const [mergeZipIncludeSubtitles, setMergeZipIncludeSubtitles] = useState(true);
  // 合并历史
  const [mergeHistoryModalOpen, setMergeHistoryModalOpen] = useState(false);
  const [mergeHistoryFiles, setMergeHistoryFiles] = useState<{ name: string; url: string; size_mb: number; modified_time: string; subtitles?: Record<string, string> }[]>([]);
  const [mergeHistoryLoading, setMergeHistoryLoading] = useState(false);


  // ==================== 播放状态 ====================
  const audioRef = useRef(new Audio());
  const chapterListRef = useRef<HTMLDivElement>(null);
  const [playingLineId, setPlayingLineId] = useState<number | null>(null);
  const [playingVoiceId, setPlayingVoiceId] = useState<number | null>(null);

  // ==================== 队列状态 ====================
  const [queueRestSize, setQueueRestSize] = useState(0);
  const [activeTab, setActiveTab] = useState('lines');

  // ==================== 计算值 ====================
  const currentChapter = currentChapterDetail;
  const currentChapterContent = currentChapterDetail?.text_content || '';

  const displayedLines = useMemo(() => {
    const kw = lineKeyword.trim().toLowerCase();
    return lines
      .filter((l) => (!roleFilter ? true : l.role_id === roleFilter))
      .filter((l) => (l.text_content || '').toLowerCase().includes(kw))
      .filter((l) => (!statusFilter ? true : l.status === statusFilter));
  }, [lines, lineKeyword, roleFilter, statusFilter]);

  const displayedRoles = useMemo(() => {
    const kw = roleKeyword.trim().toLowerCase();
    let filtered = roles.filter((r) => r.name.toLowerCase().includes(kw));
    if (roleSortByLines) {
      filtered = [...filtered].sort((a, b) => (roleLineCounts[b.id] || 0) - (roleLineCounts[a.id] || 0));
    }
    return filtered;
  }, [roles, roleKeyword, roleSortByLines, roleLineCounts]);

  const filteredVoices = useMemo(() => {
    const kw = voiceSearchName.trim().toLowerCase();
    return voices.filter((v) => !kw || v.name.toLowerCase().includes(kw));
  }, [voices, voiceSearchName]);

  const generationStats = useMemo(() => {
    const total = lines.length;
    const done = lines.filter((l) => l.status === 'done').length;
    return { total, done, percent: total ? Math.floor((done / total) * 100) : 0 };
  }, [lines]);

  // ==================== 数据加载 ====================
  const loadProject = useCallback(async () => {
    const res = await projectApi.get(projectId);
    if (res.code === 200 && res.data) setProject(res.data);
  }, [projectId]);

  // 加载章节列表：支持 append（向下追加）和 prepend（向上插入）
  const loadChaptersRef = useRef(false); // 防止并发请求
  const scrollLockRef = useRef(false); // 锁定滚动加载（navigateToChapter/scrollIntoView 期间）
  const lastDirectionRef = useRef<'replace' | 'append' | 'prepend'>('replace'); // 记录上次加载方向
  const loadChapters = useCallback(async (
    page = 1,
    keyword = '',
    direction: 'replace' | 'append' | 'prepend' = 'replace'
  ) => {
    if (loadChaptersRef.current) return;
    loadChaptersRef.current = true;
    setChapterLoading(true);
    lastDirectionRef.current = direction;
    try {
      const res = await chapterApi.getPage(projectId, { page, page_size: CHAPTER_PAGE_SIZE, keyword });
      if (res.data) {
        const { items, total, page: currentPage } = res.data;
        const offset = (currentPage - 1) * CHAPTER_PAGE_SIZE;
        setChapterTotal(total);

        if (direction === 'append') {
          // 向下追加
          setChapters(prev => [...prev, ...items]);
          setChapterHasMore(offset + items.length < total);
        } else if (direction === 'prepend') {
          // 向上插入：先记录旧高度，等 DOM 更新后补偿滚动位置
          const listEl = chapterListRef.current;
          const prevScrollHeight = listEl?.scrollHeight ?? 0;
          setChapters(prev => [...items, ...prev]);
          setChapterOffsetStart(offset);
          setChapterHasLess(offset > 0);
          // DOM 更新后补偿滚动位置，避免跳变
          requestAnimationFrame(() => {
            if (listEl) {
              listEl.scrollTop += listEl.scrollHeight - prevScrollHeight;
            }
          });
        } else {
          // 替换（搜索/初始化）
          setChapters(items);
          setChapterOffsetStart(offset);
          setChapterHasLess(offset > 0);
          setChapterHasMore(offset + items.length < total);
        }
      } else {
        if (direction === 'replace') {
          setChapters([]);
          setChapterOffsetStart(0);
        }
        setChapterHasMore(false);
        setChapterHasLess(false);
      }
    } finally {
      setChapterLoading(false);
      loadChaptersRef.current = false;
    }
  }, [projectId]);

  // 跳转到指定章节：查询位置 → 只加载该位置附近的数据
  const navigateToChapter = useCallback(async (chapterId: number) => {
    // 锁定滚动加载，避免 replace 后 scrollTop=0 触发向上加载死循环
    scrollLockRef.current = true;
    try {
      const posRes = await chapterApi.getPosition(projectId, chapterId, CHAPTER_PAGE_SIZE);
      if (posRes.data) {
        const { page } = posRes.data;
        // 只加载目标所在的那一页（约50条），不从头开始
        await loadChapters(page, '', 'replace');
      } else {
        // 章节不存在，回退加载第1页
        await loadChapters(1, '', 'replace');
      }
    } catch {
      await loadChapters(1, '', 'replace');
    }
    // 延迟解锁：等 scrollIntoView 完成后再允许滚动加载
    setTimeout(() => { scrollLockRef.current = false; }, 800);
  }, [projectId, loadChapters]);

  // 合并导出弹窗的懒加载章节列表
  const mergeLazyList = useChapterLazyList({ projectId });
  // mergeRangeEnd 需要在 mergeLazyList 声明之后计算
  const mergeRangeEnd = mergeRangeConfig.rangeEnd || mergeLazyList.total || 1;

  // 加载选中章节的完整数据（含 text_content）
  const loadChapterDetail = useCallback(async (chapterId: number) => {
    const res = await chapterApi.get(chapterId);
    if (res.data) setCurrentChapterDetail(res.data);
    else setCurrentChapterDetail(null);
  }, []);

  const loadLines = useCallback(async () => {
    if (!activeChapterId) return;
    const res = await lineApi.getByChapter(activeChapterId);
    if (res.data) setLines(res.data);
    else setLines([]);
  }, [activeChapterId]);

  const loadRoles = useCallback(async () => {
    const res = await roleApi.getByProject(projectId);
    if (res.data) {
      setRoles(res.data);
      const map: Record<number, number> = {};
      res.data.forEach((r) => {
        if (r.default_voice_id) map[r.id] = r.default_voice_id;
      });
      setRoleVoiceMap(map);
    } else {
      setRoles([]);
    }
    // 加载角色对话次数
    const sortedRes = await roleApi.getSortedByLines(projectId);
    if (sortedRes.data) {
      const counts: Record<number, number> = {};
      sortedRes.data.forEach((r) => { counts[r.id] = r.line_count; });
      setRoleLineCounts(counts);
    }
  }, [projectId]);

  const loadVoices = useCallback(async () => {
    const res = await voiceApi.getAll(project?.tts_provider_id ?? undefined);
    if (res.data) setVoices(res.data);
    else setVoices([]);
  }, [project?.tts_provider_id]);

  const loadEnums = useCallback(async () => {
    try {
      const [emoRes, strRes] = await Promise.all([emotionApi.getAll(), strengthApi.getAll()]);
      // 后端在无数据时返回 code=404 + data=[]，仍需设置
      if (Array.isArray(emoRes.data)) setEmotions(emoRes.data);
      else if (emoRes.code === 200 && emoRes.data) setEmotions(emoRes.data);
      if (Array.isArray(strRes.data)) setStrengths(strRes.data);
      else if (strRes.code === 200 && strRes.data) setStrengths(strRes.data);
    } catch (e) {
      console.error('加载情绪/强度枚举失败', e);
    }
  }, []);

  // ==================== 初始化 ====================
  useEffect(() => {
    if (projectId) {
      loadProject();
      // 如果有记忆的章节，直接跳转到该章节所在位置；否则从第1页开始
      if (activeChapterId) {
        navigateToChapter(activeChapterId);
      } else {
        loadChapters(1, '');
      }
      loadRoles();
      loadEnums();
    }
  }, [projectId]);

  useEffect(() => {
    if (project) loadVoices();
  }, [project?.tts_provider_id]);

  useEffect(() => {
    loadLines();
    // 加载选中章节的完整数据
    if (activeChapterId) {
      loadChapterDetail(activeChapterId);
    } else {
      setCurrentChapterDetail(null);
    }
  }, [activeChapterId]);

  // 章节加载完成后，自动滚动到选中的章节（仅 replace 模式时触发，避免 append/prepend 时反复滚动）
  useEffect(() => {
    if (lastDirectionRef.current !== 'replace') return;
    if (activeChapterId && chapters.length > 0 && chapterListRef.current) {
      // 使用 setTimeout 确保 DOM 已渲染完毕
      setTimeout(() => {
        if (!chapterListRef.current) return;
        const el = chapterListRef.current.querySelector(`[data-chapter-id="${activeChapterId}"]`);
        if (el) {
          el.scrollIntoView({ block: 'center', behavior: 'auto' });
        }
      }, 50);
    }
  }, [chapters]);

  // 搜索防抖：关键词变化后 400ms 触发后端搜索（仅有搜索词时才触发，清空时由 navigateToChapter 处理）
  useEffect(() => {
    // 关键词为空时不在此处加载，由其他逻辑（navigateToChapter/初始化）控制
    if (!chapterKeyword.trim()) return;
    const timer = setTimeout(() => {
      loadChapters(1, chapterKeyword.trim());
    }, 400);
    return () => clearTimeout(timer);
  }, [chapterKeyword]);

  // ==================== WebSocket ====================
  useEffect(() => {
    const unsubs = [
      subscribe('line_update', (data: WSEvent) => {
        const { line_id, status, progress, audio_path } = data;
        setQueueRestSize((progress as number) ?? 0);
        setLines((prev) =>
          prev.map((l) =>
            l.id === (line_id as number)
              ? { ...l, status: status as Line['status'], ...(audio_path ? { audio_path: audio_path as string } : {}) }
              : l,
          ),
        );
      }),
      // 监听批量 TTS 进度，更新台词状态
      subscribe('batch_tts_line_progress', (data: WSEvent) => {
        if (data.project_id === projectId) {
          const lineId = data.line_id as number;
          const status = data.status as Line['status'];
          if (lineId) {
            setLines((prev) => prev.map((l) => l.id === lineId ? { ...l, status } : l));
          }
        }
      }),
    ];
    return () => unsubs.forEach((fn) => fn());
  }, [subscribe, projectId]);

  // 音频播放事件
  useEffect(() => {
    const audio = audioRef.current;
    const onEnded = () => { setPlayingLineId(null); setPlayingVoiceId(null); };
    audio.addEventListener('ended', onEnded);
    return () => audio.removeEventListener('ended', onEnded);
  }, []);



  // ==================== 章节操作 ====================
  const handleSelectChapter = (chapter: ChapterBrief) => {
    setActiveChapterId(chapter.id);
    // 更新 URL 参数 + localStorage，记忆选中的章节
    setSearchParams({ chapter: String(chapter.id) }, { replace: true });
    localStorage.setItem(`saybook_last_chapter_${id}`, String(chapter.id));
    // 如果是搜索模式下选中，清空搜索词并跳转到该章节在正常列表中的位置
    if (chapterKeyword.trim()) {
      setChapterKeyword('');
      navigateToChapter(chapter.id);
    }
  };

  const handleCreateChapter = async () => {
    try {
      const values = await chapterForm.validateFields();
      if (chapterModalMode === 'create') {
        await chapterApi.create({ ...values, project_id: projectId });
        message.success('章节创建成功');
      } else if (editingChapter) {
        await chapterApi.update(editingChapter.id, { ...values, project_id: projectId, text_content: editingChapter.text_content });
        message.success('章节重命名成功');
      }
      setChapterModalOpen(false);
      chapterForm.resetFields();
      setEditingChapter(null);
      loadChapters(1, chapterKeyword);
    } catch {
      // 校验失败
    }
  };

  const handleDeleteChapter = async (chapterId: number) => {
    await chapterApi.delete(chapterId);
    message.success('已删除章节');
    if (activeChapterId === chapterId) {
      setActiveChapterId(null);
      // 删除章节时清除 URL 参数和 localStorage
      setSearchParams({}, { replace: true });
      localStorage.removeItem(`saybook_last_chapter_${id}`);
    }
    loadChapters(1, chapterKeyword);
  };

  const openRenameChapter = (chapter: ChapterBrief) => {
    setEditingChapter(chapter);
    setChapterModalMode('rename');
    chapterForm.setFieldsValue({ title: chapter.title });
    setChapterModalOpen(true);
  };

  // ==================== 批量导入章节 ====================
  const handleBatchImport = async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.txt';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const text = await file.text();
      if (!text.trim()) {
        message.warning('文件内容为空');
        return;
      }
      const hide = message.loading('正在导入章节...', 0);
      try {
        const res = await projectApi.importChapters(projectId, { id: projectId, content: text });
        if (res.code === 200) {
          message.success('批量导入成功');
          loadChapters(1, chapterKeyword);
        } else {
          message.error(res.message || '导入失败');
        }
      } catch {
        message.error('导入失败');
      } finally {
        hide();
      }
    };
    input.click();
  };

  // ==================== 章节正文操作 ====================
  const handleImportText = async () => {
    if (!activeChapterId || !currentChapter) return;
    const hide = message.loading('保存中...', 0);
    try {
      const res = await chapterApi.update(activeChapterId, { title: currentChapter.title, project_id: projectId, text_content: importText });
      if (res.code === 200) {
        message.success('正文已导入');
        setImportTextModal(false);
        // 刷新章节详情
        const detail = await chapterApi.get(activeChapterId);
        if (detail.data) {
          setChapters((prev) => prev.map((c) => (c.id === activeChapterId ? detail.data! : c)));
        }
      }
    } finally {
      hide();
    }
  };

  const handleEditText = async () => {
    if (!activeChapterId || !currentChapter) return;
    const hide = message.loading('保存中...', 0);
    try {
      const res = await chapterApi.update(activeChapterId, { title: currentChapter.title, project_id: projectId, text_content: editText });
      if (res.code === 200) {
        message.success('正文已保存');
        setEditTextModal(false);
        const detail = await chapterApi.get(activeChapterId);
        if (detail.data) {
          setChapters((prev) => prev.map((c) => (c.id === activeChapterId ? detail.data! : c)));
        }
      }
    } finally {
      hide();
    }
  };

  // ==================== LLM 拆分 ====================
  const handleLLMSplit = async () => {
    if (!activeChapterId) return;
    Modal.confirm({
      title: '确认操作',
      content: '确定要调用 LLM 对该章节进行台词拆分吗？此操作可能覆盖原有台词。',
      onOk: async () => {
        // 先删除原有台词
        await lineApi.deleteAll(activeChapterId);
        const hide = message.loading('正在调用 LLM 拆分台词...', 0);
        try {
          const res = await chapterApi.getLines(projectId, activeChapterId);
          if (res.code === 200) {
            message.success('LLM 拆分完成');
            loadLines();
            loadRoles();
          } else {
            message.error(res.message || '拆分失败');
          }
        } catch {
          message.error('LLM 拆分失败');
        } finally {
          hide();
        }
      },
    });
  };

  // ==================== 导入第三方 JSON ====================
  const handleImportThirdJSON = async () => {
    if (!activeChapterId) return;
    let parsed;
    try {
      parsed = JSON.parse(thirdJsonText);
      if (!Array.isArray(parsed)) throw new Error();
    } catch {
      message.error('JSON 格式非法，需要一个数组');
      return;
    }
    Modal.confirm({
      title: '确认导入',
      content: '导入将会删除本章节现有全部台词并用第三方 JSON 重建，是否继续？',
      onOk: async () => {
        await lineApi.deleteAll(activeChapterId);
        const res = await chapterApi.importLines(projectId, activeChapterId, JSON.stringify(parsed));
        if (res.code === 200) {
          message.success('导入成功');
          setImportThirdModal(false);
          loadLines();
          loadRoles();
        } else {
          message.error(res.message || '导入失败');
        }
      },
    });
  };

  // ==================== 台词操作 ====================
  const getRoleVoiceId = (roleId: number | null) => (roleId ? roleVoiceMap[roleId] || null : null);
  const getRoleVoiceName = (roleId: number) => {
    const vid = roleVoiceMap[roleId];
    return voices.find((v) => v.id === vid)?.name;
  };

  const canGenerate = (row: Line) => !!getRoleVoiceId(row.role_id);

  const handleGenerateOne = async (row: Line) => {
    if (!canGenerate(row)) {
      message.warning('请先为该角色绑定音色');
      return;
    }
    const body = {
      chapter_id: row.chapter_id,
      role_id: row.role_id,
      voice_id: getRoleVoiceId(row.role_id),
      id: row.id,
      emotion_id: row.emotion_id,
      strength_id: row.strength_id,
      text_content: row.text_content,
      audio_path: row.audio_path,
    };
    try {
      const res = await lineApi.generateAudio(projectId, row.chapter_id, body);
      if (res.code === 200) {
        message.success('已添加到生成队列');
        setLines((prev) => prev.map((l) => (l.id === row.id ? { ...l, status: 'processing' as const } : l)));
      } else {
        message.error(res.message || '生成失败');
      }
    } catch {
      message.error('生成失败');
    }
  };

  const handleGenerateAll = () => {
    const todo = displayedLines.filter((l) => canGenerate(l));
    if (!todo.length) {
      message.info('无可生成项或未绑定音色');
      return;
    }
    Modal.confirm({
      title: '批量生成',
      content: `此操作将会生成全部已绑定音色的台词（共 ${todo.length} 条），是否继续？`,
      onOk: () => { todo.forEach(handleGenerateOne); },
    });
  };

  const handleUpdateLineField = async (lineId: number, field: string, value: unknown) => {
    const line = lines.find((l) => l.id === lineId);
    if (!line) return;
    const res = await lineApi.update(lineId, { chapter_id: line.chapter_id, [field]: value });
    if (res.code === 200) {
      setLines((prev) => prev.map((l) => (l.id === lineId ? { ...l, [field]: value } : l)));
      message.success('已更新');
    } else {
      message.error(res.message || '更新失败');
    }
  };

  const handleInsertBelow = async (row: Line) => {
    if (!activeChapterId) return;
    const createRes = await lineApi.create(projectId, {
      chapter_id: row.chapter_id,
      role_id: row.role_id,
      text_content: '',
      status: 'pending',
      line_order: 0,
      is_done: 0,
      emotion_id: row.emotion_id,
      strength_id: row.strength_id,
    });
    if (createRes.code !== 200 || !createRes.data?.id) {
      message.error('插入失败');
      return;
    }
    // 重新排序
    const idx = lines.findIndex((l) => l.id === row.id);
    const newLines = [...lines];
    newLines.splice(idx + 1, 0, { ...createRes.data, text_content: '', status: 'pending' as const } as Line);
    const orders = newLines.map((l, i) => ({ id: l.id, line_order: i + 1 }));
    await lineApi.reorder(orders);
    message.success('已插入');
    loadLines();
  };

  const handleDeleteLine = async (row: Line) => {
    await lineApi.delete(row.id);
    const remaining = lines.filter((l) => l.id !== row.id);
    const orders = remaining.map((l, i) => ({ id: l.id, line_order: i + 1 }));
    if (orders.length > 0) await lineApi.reorder(orders);
    message.success('已删除');
    loadLines();
  };

  // ==================== 音频播放 ====================
  const handlePlayLine = (row: Line) => {
    const audio = audioRef.current;
    if (!row.audio_path) return;
    if (playingLineId === row.id) {
      audio.pause();
      setPlayingLineId(null);
      return;
    }
    // 通过 API 代理访问音频文件
    const src = `/api/lines/audio-file?path=${encodeURIComponent(row.audio_path)}`;
    audio.src = src;
    audio.load(); // 显式触发加载，确保浏览器重新请求资源
    setPlayingLineId(row.id);
    setPlayingVoiceId(null);
    const onCanPlay = () => {
      audio.removeEventListener('canplay', onCanPlay);
      audio.removeEventListener('error', onError);
      audio.play().catch((err) => {
        console.error('音频播放失败:', err);
        message.error(`无法播放音频: ${err.message || '未知错误'}`);
        setPlayingLineId(null);
      });
    };
    const onError = () => {
      audio.removeEventListener('canplay', onCanPlay);
      audio.removeEventListener('error', onError);
      const errCode = audio.error?.code;
      const errMsg = audio.error?.message || '未知错误';
      console.error('音频加载失败:', { code: errCode, message: errMsg, src });
      message.error(`音频加载失败 (code=${errCode}): ${errMsg}`);
      setPlayingLineId(null);
    };
    audio.addEventListener('canplay', onCanPlay);
    audio.addEventListener('error', onError);
  };

  const handlePlayVoice = (voiceId: number) => {
    const voice = voices.find((v) => v.id === voiceId);
    if (!voice?.reference_path) {
      message.warning('该音色未设置参考音频');
      return;
    }
    const audio = audioRef.current;
    if (playingVoiceId === voiceId) {
      audio.pause();
      setPlayingVoiceId(null);
      return;
    }
    audio.src = `/api/voices/audio-file?path=${encodeURIComponent(voice.reference_path)}`;
    audio.load();
    setPlayingVoiceId(voiceId);
    setPlayingLineId(null);
    const onCanPlay = () => {
      audio.removeEventListener('canplay', onCanPlay);
      audio.removeEventListener('error', onError);
      audio.play().catch((err) => {
        console.error('音色试听播放失败:', err);
        message.error(`无法播放: ${err.message || '未知错误'}`);
        setPlayingVoiceId(null);
      });
    };
    const onError = () => {
      audio.removeEventListener('canplay', onCanPlay);
      audio.removeEventListener('error', onError);
      const errCode = audio.error?.code;
      const errMsg = audio.error?.message || '未知错误';
      console.error('音色音频加载失败:', { code: errCode, message: errMsg });
      message.error(`音频加载失败 (code=${errCode}): ${errMsg}`);
      setPlayingVoiceId(null);
    };
    audio.addEventListener('canplay', onCanPlay);
    audio.addEventListener('error', onError);
  };

  // ==================== 角色操作 ====================
  const handleCreateRole = async () => {
    try {
      const values = await roleForm.validateFields();
      const res = await roleApi.create({ ...values, project_id: projectId });
      if (res.code === 200) {
        message.success('角色创建成功');
        setRoleModalOpen(false);
        roleForm.resetFields();
        loadRoles();
      } else {
        message.error(res.message || '创建失败');
      }
    } catch {
      // 校验失败
    }
  };

  const handleDeleteRole = async (roleId: number) => {
    await roleApi.delete(roleId);
    message.success('角色已删除');
    loadRoles();
    loadLines();
  };

  const handleBindVoice = async (role: Role, voiceId: number) => {
    const res = await roleApi.update(role.id, { name: role.name, project_id: role.project_id, default_voice_id: voiceId });
    if (res.code === 200) {
      const voiceName = voices.find((v) => v.id === voiceId)?.name;
      message.success(`已为「${role.name}」绑定音色「${voiceName}」`);
      setRoleVoiceMap((prev) => ({ ...prev, [role.id]: voiceId }));
      // 同步更新 roles 数组中对应角色的 default_voice_id，确保界面实时刷新
      setRoles((prev) => prev.map((r) => r.id === role.id ? { ...r, default_voice_id: voiceId } : r));
      setVoiceModalOpen(false);
    } else {
      message.error(res.message || '绑定失败');
    }
  };

  // ==================== 项目设置 ====================
  const openProjectSettings = async () => {
    if (!project) return;
    const [llmRes, ttsRes, promptRes] = await Promise.all([llmProviderApi.getAll(), ttsProviderApi.getAll(), promptApi.getAll()]);
    if (llmRes.data) setLlmProviders(llmRes.data);
    if (ttsRes.data) setTtsProviders(ttsRes.data);
    if (promptRes.data) setPrompts(promptRes.data);
    settingsForm.setFieldsValue({
      name: project.name,
      description: project.description,
      llm_provider_id: project.llm_provider_id,
      llm_model: project.llm_model,
      tts_provider_id: project.tts_provider_id,
      prompt_id: project.prompt_id,
      is_precise_fill: project.is_precise_fill,
      passerby_voice_pool: project.passerby_voice_pool || [],
      language: project.language || 'zh',
    });
    setSettingsModalOpen(true);
  };

  const handleSaveSettings = async () => {
    try {
      const values = await settingsForm.validateFields();
      const res = await projectApi.update(projectId, values);
      if (res.code === 200) {
        message.success('项目设置已保存');
        setSettingsModalOpen(false);
        loadProject();
      } else {
        message.error(res.message || '保存失败');
      }
    } catch {
      // 校验失败
    }
  };

  // ==================== 导出 ====================
  const handleExport = async () => {
    if (!activeChapterId) return;
    const hide = message.loading('正在导出...', 0);
    try {
      const res = await lineApi.exportAudio(activeChapterId, false);
      if (res.code === 200) message.success('导出成功');
      else message.error(res.message || '导出失败');
    } finally {
      hide();
    }
  };

  // ==================== 单章节一键导出（音频+字幕） ====================
  const [chapterExportLoading, setChapterExportLoading] = useState(false);
  const [chapterExportResult, setChapterExportResult] = useState<{
    audio_url: string;
    subtitles: Record<string, string>;
    duration: string;
    chapter_title: string;
  } | null>(null);
  const [chapterExportModalOpen, setChapterExportModalOpen] = useState(false);

  const handleExportChapterWithSubtitle = async () => {
    if (!activeChapterId) return;
    setChapterExportLoading(true);
    setChapterExportResult(null);
    try {
      const res = await lineApi.exportChapter(activeChapterId);
      if (res.code === 200 && res.data) {
        const data = res.data as {
          audio_url: string;
          subtitles: Record<string, string>;
          duration: string;
          chapter_title: string;
        };
        setChapterExportResult(data);
        setChapterExportModalOpen(true);
        message.success('导出成功');
      } else {
        message.error(res.message || '导出失败');
      }
    } catch {
      message.error('导出请求失败');
    } finally {
      setChapterExportLoading(false);
    }
  };

  // ==================== 通用文件下载工具 ====================
  const handleDownloadFile = async (url: string, filename?: string) => {
    const name = filename || url.split('/').pop()?.split('?')[0] || 'download';
    try {
      const resp = await fetch(url);
      const blob = await resp.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = name;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch (e) {
      // fetch 失败时回退到直接打开
      console.error('下载失败，回退到直接打开:', e);
      window.open(url, '_blank');
    }
  };

  // ==================== 合并导出 ====================
  const openMergeModal = () => {
    setMergeSelectedChapters([]);
    setMergeMode('all');
    setMergeGroupSize(1);
    setMergeDurationMinutes(30);
    setMergeResults(null);
    setMergeModalOpen(true);
    mergeLazyList.init(); // 懒加载章节列表
  };

  // 一键打包下载ZIP
  const handleMergeZipDownload = async () => {
    if (!mergeResults || mergeResults.length === 0) return;
    setMergeZipLoading(true);
    try {
      const resp = await lineApi.mergeExportZip({
        project_id: projectId,
        files: mergeResults.map(f => ({ url: f.url, name: f.name, subtitles: f.subtitles })),
        include_subtitles: mergeZipIncludeSubtitles,
      });
      const blob = new Blob([resp as unknown as BlobPart], { type: 'application/zip' });
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = 'merged_audio.zip';
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
      message.success('ZIP 打包下载成功');
    } catch {
      message.error('ZIP 打包下载失败');
    } finally {
      setMergeZipLoading(false);
    }
  };

  // 一键全部加载到播放器
  const handleMergeLoadAll = (includeSubtitles: boolean) => {
    if (!mergeResults || mergeResults.length === 0) return;
    // 依次触发下载
    mergeResults.forEach((file) => {
      handleDownloadFile(file.url, file.name);
      if (includeSubtitles) {
        if (file.subtitles?.srt) handleDownloadFile(file.subtitles.srt, `${file.name.replace('.mp3', '')}.srt`);
        if (file.subtitles?.ass) handleDownloadFile(file.subtitles.ass, `${file.name.replace('.mp3', '')}.ass`);
      }
    });
    message.success(`已开始下载 ${mergeResults.length} 个文件${includeSubtitles ? '（含字幕）' : ''}`);
  };

  // 查看合并历史
  const loadMergeHistory = async () => {
    setMergeHistoryLoading(true);
    try {
      const res = await lineApi.mergeHistory(projectId);
      if (res.code === 200 && res.data) {
        const data = res.data as { files: { name: string; url: string; size_mb: number; modified_time: string; subtitles?: Record<string, string> }[] };
        setMergeHistoryFiles(data.files || []);
      } else {
        setMergeHistoryFiles([]);
      }
    } catch {
      message.error('获取合并历史失败');
      setMergeHistoryFiles([]);
    } finally {
      setMergeHistoryLoading(false);
    }
  };

  const openMergeHistory = async () => {
    setMergeHistoryModalOpen(true);
    await loadMergeHistory();
  };

  // 删除单个合并历史文件
  const handleDeleteMergeHistoryFile = (fileName: string) => {
    Modal.confirm({
      title: '确认删除',
      content: `确定要删除 "${fileName}" 及其对应字幕文件吗？此操作不可恢复。`,
      okText: '确认删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          const res = await lineApi.deleteMergeHistoryFile({ project_id: projectId, file_name: fileName });
          if (res.code === 200) {
            message.success('删除成功');
            await loadMergeHistory();
          } else {
            message.error(res.message || '删除失败');
          }
        } catch {
          message.error('删除失败');
        }
      },
    });
  };

  // 一键清空合并历史
  const handleClearMergeHistory = () => {
    Modal.confirm({
      title: '确认清空',
      content: '确定要清空所有合并历史文件吗？包括所有MP3和字幕文件，此操作不可恢复！',
      okText: '确认清空',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          const res = await lineApi.clearMergeHistory(projectId);
          if (res.code === 200) {
            message.success(res.message || '已清空');
            await loadMergeHistory();
          } else {
            message.error(res.message || '清空失败');
          }
        } catch {
          message.error('清空失败');
        }
      },
    });
  };

  const handleMergeExport = async () => {
    if (mergeSelectedChapters.length === 0) {
      message.warning('请选择要合并的章节');
      return;
    }
    setMergeLoading(true);
    setMergeResults(null);
    try {
      const res = await lineApi.mergeExport({
        project_id: projectId,
        chapter_ids: mergeSelectedChapters,
        group_size: mergeMode === 'group' ? mergeGroupSize : 0,
        max_duration_minutes: mergeMode === 'duration' ? mergeDurationMinutes : 0,
      });
      if (res.code === 200 && res.data) {
        const data = res.data as { files: { name: string; url: string; chapters: string[]; duration?: string; subtitles?: Record<string, string> }[] };
        setMergeResults(data.files);
        message.success(res.message || '合并完成');
      } else {
        message.error(res.message || '合并失败');
      }
    } catch {
      message.error('合并导出请求失败');
    } finally {
      setMergeLoading(false);
    }
  };

  const handleMergeSelectAll = (checked: boolean) => {
    if (checked) {
      // 选中当前已加载的章节
      const ids = mergeLazyList.chapters.map(c => c.id);
      setMergeSelectedChapters(prev => {
        const combined = new Set([...prev, ...ids]);
        return Array.from(combined);
      });
      message.info('已选中当前可见章节。如需全部选中，请滚动加载更多。');
    } else {
      setMergeSelectedChapters([]);
    }
  };

  const handleMergeChapterToggle = (chapterId: number, checked: boolean) => {
    if (checked) {
      setMergeSelectedChapters(prev => [...prev, chapterId]);
    } else {
      setMergeSelectedChapters(prev => prev.filter(id => id !== chapterId));
    }
  };

  // 合并导出：按范围选择
  const handleMergeSelectRange = useCallback(async () => {
    const start = Math.max(1, mergeRangeStart);
    const end = Math.min(mergeLazyList.total, mergeRangeEnd);
    if (start > end) {
      message.warning('起始章节不能大于结束章节');
      return;
    }
    setMergeRangeLoading(true);
    try {
      const res = await chapterApi.getIdsByRange(projectId, { start, end });
      if (res.data && res.data.length > 0) {
        setMergeSelectedChapters(res.data);
        message.success(`已选中第 ${start} ~ ${end} 章，共 ${res.data.length} 个章节`);
      } else {
        setMergeSelectedChapters([]);
        message.warning(`第 ${start} ~ ${end} 章中没有章节`);
      }
      // 清空列表并跳转到 L 位置
      mergeLazyList.reset();
      await mergeLazyList.jumpToIndex(start);
    } catch {
      message.error('获取范围章节失败');
    } finally {
      setMergeRangeLoading(false);
    }
  }, [mergeRangeStart, mergeRangeEnd, mergeLazyList, projectId]);

  // 仅当持久化中没有保存过范围（rangeEnd 为 0）时，设置默认值
  useEffect(() => {
    if (mergeModalOpen && mergeLazyList.total > 0 && mergeRangeConfig.rangeEnd === 0) {
      updateMergeRange('rangeEnd', mergeLazyList.total);
    }
  }, [mergeModalOpen, mergeLazyList.total]); // eslint-disable-line react-hooks/exhaustive-deps

  // ==================== 台词表格列 ====================
  const statusType = (s: string) => {
    const map: Record<string, string> = { done: 'success', processing: 'processing', failed: 'error', pending: 'default' };
    return map[s] || 'default';
  };
  const statusText = (s: string) => {
    const map: Record<string, string> = { done: '已生成', processing: '生成中', failed: '生成失败', pending: '未生成' };
    return map[s] || s;
  };

  const lineColumns = [
    {
      title: '序',
      dataIndex: 'line_order',
      key: 'line_order',
      width: 50,
      render: (_: unknown, __: unknown, index: number) => index + 1,
    },
    {
      title: '角色',
      dataIndex: 'role_id',
      key: 'role_id',
      width: 140,
      render: (roleId: number, record: Line) => {
        // 构建 options：始终基于 roles 列表，并确保当前已选值一定存在（避免显示数字）
        const baseOptions = roles.map((r) => ({ value: r.id, label: r.name }));
        if (roleId && !baseOptions.some(o => o.value === roleId)) {
          baseOptions.unshift({ value: roleId, label: `角色#${roleId}` });
        }
        return (
          <div>
            <Select
              size="small"
              value={roleId || undefined}
              style={{ width: '100%' }}
              placeholder="选择角色"
              allowClear
              showSearch
              optionFilterProp="label"
              options={baseOptions}
              onChange={(val) => handleUpdateLineField(record.id, 'role_id', val || null)}
            />
            <Tag color={getRoleVoiceName(roleId) ? 'green' : 'default'} style={{ marginTop: 4, fontSize: 11 }}>
              {getRoleVoiceName(roleId) || '未绑定音色'}
            </Tag>
          </div>
        );
      },
    },
    {
      title: '台词文本',
      dataIndex: 'text_content',
      key: 'text_content',
      width: 250,
      render: (text: string, record: Line) => (
        <Input.TextArea
          size="small"
          defaultValue={text}
          autoSize={{ minRows: 2, maxRows: 6 }}
          onBlur={(e) => {
            if (e.target.value !== text) {
              handleUpdateLineField(record.id, 'text_content', e.target.value);
            }
          }}
        />
      ),
    },
    {
      title: '情绪',
      dataIndex: 'emotion_id',
      key: 'emotion_id',
      width: 90,
      render: (emotionId: number | null, record: Line) => {
        // 构建 options：始终基于 emotions 列表，并确保当前已选值一定存在
        const baseOptions = emotions.map((e) => ({ value: e.id, label: e.name }));
        // 如果当前行有 emotionId 但不在列表中，补充一个选项（避免显示数字）
        if (emotionId && !baseOptions.some(o => o.value === emotionId)) {
          const name = emotionMap.get(emotionId);
          if (name) {
            baseOptions.unshift({ value: emotionId, label: name });
          }
        }
        return (
          <Select
            size="small"
            value={emotionId ?? undefined}
            style={{ width: '100%' }}
            placeholder="选择情绪"
            allowClear
            showSearch
            optionFilterProp="label"
            options={baseOptions}
            onChange={(val) => handleUpdateLineField(record.id, 'emotion_id', val ?? null)}
            notFoundContent="暂无情绪选项"
            // 确保即使 options 中没匹配到也显示中文而非数字
            labelRender={(props) => {
              const matched = baseOptions.find(o => o.value === props.value);
              return <span>{matched?.label ?? (emotionId ? (emotionMap.get(emotionId) || '未知情绪') : props.label)}</span>;
            }}
          />
        );
      },
    },
    {
      title: '强度',
      dataIndex: 'strength_id',
      key: 'strength_id',
      width: 90,
      render: (strengthId: number | null, record: Line) => {
        // 构建 options：始终基于 strengths 列表，并确保当前已选值一定存在
        const baseOptions = strengths.map((s) => ({ value: s.id, label: s.name }));
        // 如果当前行有 strengthId 但不在列表中，补充一个选项（避免显示数字）
        if (strengthId && !baseOptions.some(o => o.value === strengthId)) {
          const name = strengthMap.get(strengthId);
          if (name) {
            baseOptions.unshift({ value: strengthId, label: name });
          }
        }
        return (
          <Select
            size="small"
            value={strengthId ?? undefined}
            style={{ width: '100%' }}
            placeholder="选择强度"
            allowClear
            showSearch
            optionFilterProp="label"
            options={baseOptions}
            onChange={(val) => handleUpdateLineField(record.id, 'strength_id', val ?? null)}
            notFoundContent="暂无强度选项"
            // 确保即使 options 中没匹配到也显示中文而非数字
            labelRender={(props) => {
              const matched = baseOptions.find(o => o.value === props.value);
              return <span>{matched?.label ?? (strengthId ? (strengthMap.get(strengthId) || '未知强度') : props.label)}</span>;
            }}
          />
        );
      },
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 70,
      render: (status: string) => (
        <Tag color={statusType(status)} style={{ margin: 0, fontSize: 11 }}>
          {statusText(status)}
        </Tag>
      ),
    },
    {
      title: '试听',
      key: 'play',
      width: 240,
      render: (_: unknown, record: Line) => {
        const isDone = record.audio_path && record.status === 'done';
        if (!isDone) return <Text type="secondary" style={{ fontSize: 11 }}>—</Text>;
        const audioUrl = `/api/lines/audio-file?path=${encodeURIComponent(record.audio_path!)}&t=${record.updated_at || ''}`;
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <AudioWaveform url={audioUrl} height={32} mini />
            </div>
            <SpeedControl lineId={record.id} type="line" size="small" currentSpeed={record.speed ?? 1.0} onComplete={loadLines} />
          </div>
        );
      },
    },
    {
      title: '操作',
      key: 'actions',
      width: 140,
      render: (_: unknown, record: Line) => {
        const isProcessing = record.status === 'processing';
        return (
          <Space size={4}>
            <Tooltip title={isProcessing ? '生成中...' : !canGenerate(record) ? '请先绑定音色' : '生成语音'}>
              <Button
                size="small"
                type="link"
                icon={<SoundOutlined />}
                disabled={!canGenerate(record) || isProcessing}
                loading={isProcessing}
                onClick={() => handleGenerateOne(record)}
                style={{ fontSize: 12, padding: '0 4px' }}
              />
            </Tooltip>
            <Tooltip title="在下方插入">
              <Button
                size="small"
                type="link"
                icon={<PlusOutlined />}
                onClick={() => handleInsertBelow(record)}
                style={{ fontSize: 12, padding: '0 4px' }}
              />
            </Tooltip>
            <Popconfirm title="确认删除？" onConfirm={() => handleDeleteLine(record)} okText="删除" cancelText="取消">
              <Tooltip title="删除">
                <Button
                  size="small"
                  type="link"
                  danger
                  icon={<DeleteOutlined />}
                  style={{ fontSize: 12, padding: '0 4px' }}
                />
              </Tooltip>
            </Popconfirm>
          </Space>
        );
      },
    },
  ];

  // ==================== 渲染 ====================
  return (
    <Layout style={{ background: 'transparent', height: '100%' }}>
      {/* ==================== 左侧章节面板 ==================== */}
      <Sider
        width={260}
        style={{ background: '#1e1e2e', borderRight: '1px solid #313244', borderRadius: 8, marginRight: 16, overflow: 'hidden' }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        {/* 顶部：返回 + 项目名 */}
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #313244' }}>
          <Space>
            <Button type="text" icon={<ArrowLeftOutlined />} onClick={() => navigate('/projects')} style={{ color: '#cdd6f4' }} />
            <Text strong style={{ color: '#cdd6f4', fontSize: 15 }}>{project?.name || '项目'}</Text>
          </Space>
          <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Tag>章节 {chapterTotal}</Tag>
            <Tag>角色 {roles.length}</Tag>
            <Tag>台词 {lines.length}</Tag>
            {queueRestSize > 0 && <Tag color="red">队列 {queueRestSize}</Tag>}
          </div>
        </div>

        {/* 操作区 */}
        <div style={{ padding: '8px 12px', display: 'flex', gap: 6 }}>
          <Button
            size="small"
            type="primary"
            ghost
            icon={<UploadOutlined />}
            onClick={handleBatchImport}
          >
            批量导入
          </Button>
          <Button
            size="small"
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              setChapterModalMode('create');
              chapterForm.resetFields();
              setChapterModalOpen(true);
            }}
          >
            新建
          </Button>
        </div>

        {/* 搜索 */}
        <div style={{ padding: '0 12px 8px' }}>
          <Input
            size="small"
            prefix={<SearchOutlined />}
            placeholder="搜索章节名（双击选中后自动跳转）"
            allowClear
            value={chapterKeyword}
            onChange={(e) => {
              const kw = e.target.value;
              setChapterKeyword(kw);
              // 清空搜索词时，跳回到当前选中章节的位置
              if (!kw.trim() && activeChapterId) {
                navigateToChapter(activeChapterId);
              }
            }}
            onPressEnter={() => {
              // 按回车立即搜索
              if (chapterKeyword.trim()) {
                loadChapters(1, chapterKeyword.trim());
              }
            }}
            suffix={chapterKeyword.trim() ? (
              <Text style={{ fontSize: 11, color: '#6c7086' }}>
                {chapters.length}/{chapterTotal}
              </Text>
            ) : (
              <Text style={{ fontSize: 11, color: '#6c7086' }}>
                {chapterTotal}
              </Text>
            )}
          />
        </div>

        {/* 章节列表 */}
        <div
          ref={chapterListRef}
          style={{ flex: 1, overflow: 'auto', padding: '0 8px 8px' }}
          onScroll={(e) => {
            // 如果正在进行跳转（navigateToChapter / scrollIntoView），不触发任何加载
            if (scrollLockRef.current) return;
            const target = e.currentTarget;
            // 向下滚动到底部附近时加载更多
            if (target.scrollHeight - target.scrollTop - target.clientHeight < 100 && chapterHasMore && !chapterLoading) {
              const nextPage = Math.floor((chapterOffsetStart + chapters.length) / CHAPTER_PAGE_SIZE) + 1;
              loadChapters(nextPage, chapterKeyword.trim(), 'append');
            }
            // 向上滚动到顶部附近时加载前面的数据
            if (target.scrollTop < 100 && chapterHasLess && !chapterLoading) {
              const prevPage = Math.floor(chapterOffsetStart / CHAPTER_PAGE_SIZE);
              if (prevPage >= 1) {
                loadChapters(prevPage, chapterKeyword.trim(), 'prepend');
              }
            }
          }}
        >
          {chapterHasLess && !chapterLoading && (
            <div style={{ textAlign: 'center', padding: 8, color: '#6c7086' }}>
              <Text style={{ fontSize: 11, color: '#585b70' }}>↑ 向上滚动加载更多</Text>
            </div>
          )}
          {chapters.map((ch) => (
            <Card
              key={ch.id}
              data-chapter-id={ch.id}
              size="small"
              hoverable
              style={{
                marginBottom: 6,
                background: activeChapterId === ch.id ? '#313244' : '#181825',
                borderColor: activeChapterId === ch.id ? '#6366f1' : '#313244',
                cursor: 'pointer',
              }}
              onClick={() => handleSelectChapter(ch)}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ flex: 1, color: '#cdd6f4' }} ellipsis>{ch.title}</Text>
                <Space size={2}>
                  <Tooltip title="重命名">
                    <EditOutlined
                      style={{ fontSize: 12, color: '#89b4fa' }}
                      onClick={(e) => { e.stopPropagation(); openRenameChapter(ch); }}
                    />
                  </Tooltip>
                  <Popconfirm title="确认删除？" onConfirm={() => handleDeleteChapter(ch.id)}>
                    <DeleteOutlined
                      style={{ fontSize: 12, color: '#f38ba8' }}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </Popconfirm>
                </Space>
              </div>
            </Card>
          ))}
          {chapterLoading && (
            <div style={{ textAlign: 'center', padding: 12, color: '#6c7086' }}>
              <Text type="secondary">加载中...</Text>
            </div>
          )}
          {!chapterLoading && chapters.length === 0 && (
            <div style={{ textAlign: 'center', padding: 20, color: '#6c7086' }}>
              <Text type="secondary">暂无章节</Text>
            </div>
          )}
          {!chapterLoading && !chapterHasMore && chapters.length > 0 && chapterKeyword.trim() && (
            <div style={{ textAlign: 'center', padding: 8, color: '#6c7086' }}>
              <Text style={{ fontSize: 11, color: '#585b70' }}>搜索到 {chapterTotal} 个结果</Text>
            </div>
          )}
        </div>
        </div>
      </Sider>

      {/* ==================== 右侧内容区 ==================== */}
      <Content style={{ display: 'flex', flexDirection: 'column', gap: 12, overflow: 'hidden' }}>
        {/* 批量LLM后台运行提示条 */}
        {batchLLMRunning && !batchLLMModalOpen && (
          <div
            style={{
              background: 'linear-gradient(90deg, #1e1b4b, #312e81)',
              borderRadius: 8,
              padding: '8px 16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              border: '1px solid #4f46e5',
              cursor: 'pointer',
              flexShrink: 0,
            }}
            onClick={() => setBatchLLMModalOpen(true)}
          >
            <Space>
              <RobotOutlined style={{ color: '#818cf8', fontSize: 16 }} spin />
              <Text style={{ color: '#c7d2fe', fontSize: 13 }}>
                批量LLM解析进行中 ({batchLLMCurrent}/{batchLLMTotal})
              </Text>
              <Progress
                percent={batchLLMProgress}
                size="small"
                style={{ width: 120, margin: 0 }}
                strokeColor="#6366f1"
                trailColor="#1e1b4b"
                format={() => `${batchLLMProgress}%`}
              />
            </Space>
            <Text style={{ color: '#818cf8', fontSize: 12 }}>点击查看详情 →</Text>
          </div>
        )}
        {/* 一键挂机后台运行提示条 */}
        {autoPilotRunning && !autoPilotModalOpen && (
          <div
            style={{
              background: 'linear-gradient(90deg, #422006, #78350f)',
              borderRadius: 8,
              padding: '8px 16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              border: '1px solid #f59e0b',
              cursor: 'pointer',
              flexShrink: 0,
            }}
            onClick={() => setAutoPilotModalOpen(true)}
          >
            <Space>
              <RocketOutlined style={{ color: '#fbbf24', fontSize: 16 }} spin />
              <Text style={{ color: '#fef3c7', fontSize: 13 }}>
                一键挂机进行中
              </Text>
              <Progress
                percent={autoPilotProgress}
                size="small"
                style={{ width: 120, margin: 0 }}
                strokeColor="#f59e0b"
                trailColor="#422006"
                format={() => `${autoPilotProgress}%`}
              />
            </Space>
            <Text style={{ color: '#fbbf24', fontSize: 12 }}>点击查看详情 →</Text>
          </div>
        )}
        {!activeChapterId ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Empty description="请从左侧选择一个章节" />
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, flex: 1, minHeight: 0, overflow: 'hidden' }}>
            {/* ==================== 章节正文卡片 ==================== */}
            <Card
              size="small"
              style={{ background: '#1e1e2e', borderColor: '#313244' }}
              title={
                <Space>
                  <Text style={{ color: '#cdd6f4' }}>{currentChapter?.title || '章节'}</Text>
                  {currentChapterContent && <Tag>{currentChapterContent.length} 字</Tag>}
                  {lines.length > 0 && (
                    <Progress
                      percent={generationStats.percent}
                      size="small"
                      style={{ width: 150 }}
                      format={() => `${generationStats.done}/${generationStats.total}`}
                    />
                  )}
                </Space>
              }
              extra={
                <Space>
                  <Button size="small" onClick={() => setChapterCollapsed(!chapterCollapsed)}>
                    {chapterCollapsed ? '展开正文' : '收起正文'}
                  </Button>
                  <Button size="small" icon={<UploadOutlined />} onClick={() => { setImportText(''); setImportTextModal(true); }}>
                    导入/粘贴
                  </Button>
                  <Button
                    size="small"
                    icon={<EditOutlined />}
                    disabled={!currentChapter}
                    onClick={() => { setEditText(currentChapterContent); setEditTextModal(true); }}
                  >
                    编辑
                  </Button>
                  <Button
                    size="small"
                    type="primary"
                    icon={<RobotOutlined />}
                    disabled={!currentChapterContent}
                    onClick={handleLLMSplit}
                  >
                    LLM 拆分
                  </Button>
                  <Button
                    size="small"
                    icon={<RobotOutlined />}
                    style={{ background: '#6366f1', color: '#fff', borderColor: '#6366f1' }}
                    onClick={() => setBatchLLMModalOpen(true)}
                  >
                    批量LLM
                  </Button>
                  <Button
                    size="small"
                    icon={<SoundOutlined />}
                    style={{ background: '#52c41a', color: '#fff', borderColor: '#52c41a' }}
                    onClick={() => setBatchTTSModalOpen(true)}
                  >
                    批量配音
                  </Button>
                  <Button
                    size="small"
                    icon={<RocketOutlined />}
                    style={{ background: '#f59e0b', color: '#fff', borderColor: '#f59e0b' }}
                    onClick={() => setAutoPilotModalOpen(true)}
                  >
                    一键挂机
                  </Button>
                  <Button
                    size="small"
                    icon={<UploadOutlined />}
                    onClick={() => { setThirdJsonText(''); setImportThirdModal(true); }}
                  >
                    导入JSON
                  </Button>
                  <Button
                    size="small"
                    icon={<MergeCellsOutlined />}
                    style={{ background: '#fa8c16', color: '#fff', borderColor: '#fa8c16' }}
                    onClick={openMergeModal}
                  >
                    合并导出
                  </Button>
                  <Button size="small" icon={<SettingOutlined />} onClick={openProjectSettings}>
                    设置
                  </Button>
                </Space>
              }
            >
              {!chapterCollapsed && (
                currentChapterContent ? (
                  <div style={{ maxHeight: 200, overflow: 'auto' }}>
                    <pre style={{ whiteSpace: 'pre-wrap', color: '#cdd6f4', fontSize: 13, margin: 0 }}>{currentChapterContent}</pre>
                  </div>
                ) : (
                  <Empty description="尚未导入章节正文" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                )
              )}
            </Card>

            {/* ==================== Tabs: 台词管理 + 角色库 ==================== */}
            <Card size="small" style={{ background: '#1e1e2e', borderColor: '#313244', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }} bodyStyle={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden' }}>
              <Tabs
                activeKey={activeTab}
                onChange={setActiveTab}
                tabBarStyle={{ padding: '0 16px' }}
                items={[
                  {
                    key: 'lines',
                    label: `台词管理 (${lines.length})`,
                    children: (
                      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, padding: '0 16px 16px', overflow: 'hidden' }}>
                        {/* 工具栏 */}
                        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                          <Select
                            size="small"
                            style={{ width: 150 }}
                            placeholder="按角色筛选"
                            allowClear
                            showSearch
                            optionFilterProp="label"
                            value={roleFilter}
                            options={roles.map((r) => ({ value: r.id, label: r.name }))}
                            onChange={setRoleFilter}
                          />
                          <Select
                            size="small"
                            style={{ width: 120 }}
                            placeholder="按状态筛选"
                            allowClear
                            value={statusFilter || undefined}
                            options={[
                              { value: 'pending', label: '未生成' },
                              { value: 'processing', label: '生成中' },
                              { value: 'done', label: '已生成' },
                              { value: 'failed', label: '失败' },
                            ]}
                            onChange={(v) => setStatusFilter(v || '')}
                          />
                          <Input
                            size="small"
                            style={{ width: 180 }}
                            prefix={<SearchOutlined />}
                            placeholder="搜索台词"
                            allowClear
                            value={lineKeyword}
                            onChange={(e) => setLineKeyword(e.target.value)}
                          />
                          <Button size="small" icon={<ReloadOutlined />} onClick={loadLines} />
                          <Divider type="vertical" />
                          <Button size="small" type="primary" icon={<ThunderboltOutlined />} onClick={handleGenerateAll}>
                            批量生成
                          </Button>
                          {activeChapterId && (
                            <SpeedControl
                              type="chapter"
                              chapterId={activeChapterId}
                              size="small"
                              currentSpeed={(() => {
                                // 从当前章节台词中计算代表性的全局语速（取最常用的速度值）
                                const doneLines = lines.filter(l => l.audio_path && l.status === 'done');
                                if (doneLines.length === 0) return 1.0;
                                const speedCounts: Record<number, number> = {};
                                doneLines.forEach(l => {
                                  const s = l.speed ?? 1.0;
                                  speedCounts[s] = (speedCounts[s] || 0) + 1;
                                });
                                // 取出现次数最多的速度值
                                let maxCount = 0, maxSpeed = 1.0;
                                for (const [s, c] of Object.entries(speedCounts)) {
                                  if (c > maxCount) { maxCount = c; maxSpeed = Number(s); }
                                }
                                return maxSpeed;
                              })()}
                              onComplete={loadLines}
                            />
                          )}
                          <Button size="small" type="default" icon={<DownloadOutlined />} onClick={handleExport} style={{ background: '#52c41a', color: '#fff', borderColor: '#52c41a' }}>
                            导出
                          </Button>
                          <Tooltip title="一键导出本章音频(MP3)+字幕(SRT/ASS)">
                            <Button
                              size="small"
                              icon={<FileTextOutlined />}
                              loading={chapterExportLoading}
                              onClick={handleExportChapterWithSubtitle}
                              style={{ background: '#13c2c2', color: '#fff', borderColor: '#13c2c2' }}
                            >
                              导出音频+字幕
                            </Button>
                          </Tooltip>
                        </div>

                        {/* 台词表格 */}
                        <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
                          <Table
                            dataSource={displayedLines}
                            columns={lineColumns}
                            rowKey="id"
                            size="small"
                            pagination={false}
                            scroll={{ x: 1100, y: 'calc(100vh - 280px)' }}
                          />
                        </div>
                      </div>
                    ),
                  },
                  {
                    key: 'roles',
                    label: `角色库 (${roles.length})`,
                    children: (
                      <div style={{ padding: '0 16px 16px', flex: 1, minHeight: 0, overflowY: 'auto' }}>
                        {/* 工具栏 */}
                        <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
                          <Input
                            size="small"
                            style={{ width: 200 }}
                            prefix={<SearchOutlined />}
                            placeholder="搜索角色"
                            allowClear
                            value={roleKeyword}
                            onChange={(e) => setRoleKeyword(e.target.value)}
                          />
                          <Button size="small" icon={<ReloadOutlined />} onClick={loadRoles} />
                          <Divider type="vertical" />
                          <Button size="small" type="primary" onClick={() => navigate('/voices')}>
                            管理音色库
                          </Button>
                          <Button
                            size="small"
                            type="primary"
                            ghost
                            icon={<PlusOutlined />}
                            onClick={() => { roleForm.resetFields(); setRoleModalOpen(true); }}
                          >
                            新建角色
                          </Button>
                          <Button
                            size="small"
                            style={{ background: '#f5222d', color: '#fff', borderColor: '#f5222d' }}
                            onClick={async () => {
                              if (!activeChapterId) return;
                              const hide = message.loading('智能匹配中...', 0);
                              try {
                                const res = await chapterApi.smartMatch(projectId, activeChapterId);
                                if (res.code === 200) {
                                  message.success('智能匹配完成');
                                  loadRoles();
                                  loadLines();
                                } else {
                                  message.error(res.message || '匹配失败');
                                }
                              } finally {
                                hide();
                              }
                            }}
                          >
                          🤖 智能匹配音色
                          </Button>
                          <Button
                            size="small"
                            style={{ background: '#722ed1', color: '#fff', borderColor: '#722ed1' }}
                            onClick={async () => {
                              const hide = message.loading('随机分配路人语音中...', 0);
                              try {
                                const res = await roleApi.assignPasserbyVoices(projectId);
                                if (res.code === 200) {
                                  message.success(res.message || '分配完成');
                                  loadRoles();
                                  loadLines();
                                } else {
                                  message.warning(res.message || '分配失败');
                                }
                              } finally {
                                hide();
                              }
                            }}
                          >
                            🎲 路人语音池随机分配
                          </Button>
                          <Divider type="vertical" />
                          <Checkbox checked={roleSortByLines} onChange={(e) => setRoleSortByLines(e.target.checked)}>
                            按对话次数排序
                          </Checkbox>
                        </div>

                        {/* 角色卡片网格 */}
                        <Row gutter={[12, 12]}>
                          {displayedRoles.map((r) => (
                            <Col xs={24} sm={12} md={8} lg={6} key={r.id}>
                              <Card
                                size="small"
                                hoverable
                                style={{ background: '#181825', borderColor: '#313244' }}
                              >
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                                  <Space>
                                    <Avatar size={28} style={{ background: '#6366f1' }}>{r.name.slice(0, 1)}</Avatar>
                                    <Text strong style={{ color: '#cdd6f4' }}>{r.name}</Text>
                                    <Tag color="blue" style={{ fontSize: 11 }}>{roleLineCounts[r.id] || 0} 句</Tag>
                                  </Space>
                                  <Popconfirm title="确定删除？" onConfirm={() => handleDeleteRole(r.id)}>
                                    <Button type="text" danger size="small" icon={<DeleteOutlined />} />
                                  </Popconfirm>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                  <Tag color={getRoleVoiceName(r.id) ? 'green' : 'default'}>
                                    {getRoleVoiceName(r.id) || '未绑定音色'}
                                  </Tag>
                                  <Space size={4}>
                                    {roleVoiceMap[r.id] && (
                                      <Button
                                        size="small"
                                        type="text"
                                        icon={playingVoiceId === roleVoiceMap[r.id] ? <PauseCircleOutlined /> : <SoundOutlined />}
                                        onClick={() => handlePlayVoice(roleVoiceMap[r.id])}
                                      />
                                    )}
                                    <Button
                                      size="small"
                                      type="primary"
                                      onClick={() => { setVoiceModalRole(r); setVoiceSearchName(''); setVoiceModalOpen(true); }}
                                    >
                                      {getRoleVoiceName(r.id) ? '更换' : '绑定'}
                                    </Button>
                                  </Space>
                                </div>
                              </Card>
                            </Col>
                          ))}
                        </Row>
                        {displayedRoles.length === 0 && (
                          <Empty description="暂无角色，请先用 LLM 拆分台词或手动创建角色" />
                        )}
                      </div>
                    ),
                  },
                ]}
              />
            </Card>
          </div>
        )}
      </Content>

      {/* ==================== 弹窗区域 ==================== */}

      {/* 新建/重命名章节 */}
      <Modal
        title={chapterModalMode === 'create' ? '新建章节' : '重命名章节'}
        open={chapterModalOpen}
        onOk={handleCreateChapter}
        onCancel={() => setChapterModalOpen(false)}
        destroyOnClose
      >
        <Form form={chapterForm} layout="vertical">
          <Form.Item name="title" label="章节标题" rules={[{ required: true, message: '请输入章节标题' }]}>
            <Input placeholder="例如：第一章 初遇" />
          </Form.Item>
        </Form>
      </Modal>

      {/* 导入/粘贴正文 */}
      <Modal title="导入/粘贴章节正文" open={importTextModal} onOk={handleImportText} onCancel={() => setImportTextModal(false)} width={720}>
        <Input.TextArea rows={14} value={importText} onChange={(e) => setImportText(e.target.value)} placeholder="在此处粘贴本章节全文…" />
      </Modal>

      {/* 编辑正文 */}
      <Modal title="编辑章节正文" open={editTextModal} onOk={handleEditText} onCancel={() => setEditTextModal(false)} width={720}>
        <Input.TextArea rows={14} value={editText} onChange={(e) => setEditText(e.target.value)} placeholder="编辑本章节全文…" />
      </Modal>

      {/* 导入第三方 JSON */}
      <Modal title="导入第三方 JSON" open={importThirdModal} onOk={handleImportThirdJSON} onCancel={() => setImportThirdModal(false)} width={720}>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
          请粘贴一个 JSON 数组，每个元素形如 {`{ "role_name": "...", "text_content": "...", "emotion_name": "...", "strength_name": "..." }`}
        </Typography.Paragraph>
        <Input.TextArea rows={14} value={thirdJsonText} onChange={(e) => setThirdJsonText(e.target.value)} placeholder='[{"role_name":"旁白","text_content":"..."}]' />
      </Modal>

      {/* 新建角色 */}
      <Modal title="新建角色" open={roleModalOpen} onOk={handleCreateRole} onCancel={() => setRoleModalOpen(false)} destroyOnClose>
        <Form form={roleForm} layout="vertical">
          <Form.Item name="name" label="角色名称" rules={[{ required: true, message: '请输入角色名称' }]}>
            <Input placeholder="如：路人甲 / 萧炎" />
          </Form.Item>
          <Form.Item name="description" label="角色描述">
            <Input placeholder="可选：角色备注" />
          </Form.Item>
          <Form.Item name="default_voice_id" label="默认音色">
            <Select allowClear showSearch optionFilterProp="label" placeholder="可选" options={voices.map((v) => ({ value: v.id, label: v.name }))} />
          </Form.Item>
        </Form>
      </Modal>

      {/* 选择音色弹窗 */}
      <Modal title="选择音色" open={voiceModalOpen} onCancel={() => setVoiceModalOpen(false)} footer={null} width={820}>
        <div style={{ marginBottom: 12 }}>
          <Input
            placeholder="搜索音色名称"
            allowClear
            value={voiceSearchName}
            onChange={(e) => setVoiceSearchName(e.target.value)}
            style={{ width: 300 }}
          />
        </div>
        <div style={{ maxHeight: '60vh', overflow: 'auto' }}>
          <Row gutter={[12, 12]}>
            {filteredVoices.map((v) => (
              <Col xs={24} sm={12} md={8} key={v.id}>
                <Card
                  size="small"
                  hoverable
                  style={{ cursor: 'pointer', overflow: 'hidden' }}
                  onClick={() => voiceModalRole && handleBindVoice(voiceModalRole, v.id)}
                >
                  <div style={{ marginBottom: 8 }}>
                    <Text strong style={{ wordBreak: 'break-all' }}>{v.name}</Text>
                    <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {v.description?.split(',').map((tag, i) => (
                        <Tag key={i} style={{ marginBottom: 0, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis' }}>{tag.trim()}</Tag>
                      ))}
                      {!v.description && <Text type="secondary" style={{ fontSize: 12 }}>无标签</Text>}
                    </div>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Button
                      size="small"
                      icon={playingVoiceId === v.id ? <PauseCircleOutlined /> : <SoundOutlined />}
                      onClick={(e) => { e.stopPropagation(); handlePlayVoice(v.id); }}
                    >
                      试听
                    </Button>
                    <Button type="primary" size="small" onClick={(e) => { e.stopPropagation(); voiceModalRole && handleBindVoice(voiceModalRole, v.id); }}>
                      选择
                    </Button>
                  </div>
                </Card>
              </Col>
            ))}
          </Row>
          {filteredVoices.length === 0 && <Empty description="无匹配音色" />}
        </div>
      </Modal>

      {/* 批量 LLM 解析弹窗 */}
      <BatchLLMModal
        open={batchLLMModalOpen}
        onClose={() => setBatchLLMModalOpen(false)}
        projectId={projectId}
        onComplete={() => {
          loadChapters(1, chapterKeyword);
          loadLines();
          loadRoles();
        }}
        onRunningChange={useCallback((running: boolean, progress: number, current: number, total: number) => {
          setBatchLLMRunning(running);
          setBatchLLMProgress(progress);
          setBatchLLMCurrent(current);
          setBatchLLMTotal(total);
        }, [])}
      />

      {/* 批量 TTS 配音弹窗 */}
      <BatchTTSModal
        open={batchTTSModalOpen}
        onClose={() => setBatchTTSModalOpen(false)}
        projectId={projectId}
        onComplete={() => {
          loadLines();
        }}
      />

      {/* 一键挂机弹窗 */}
      <AutoPilotModal
        open={autoPilotModalOpen}
        onClose={() => setAutoPilotModalOpen(false)}
        projectId={projectId}
        onComplete={() => {
          loadChapters(1, chapterKeyword);
          loadLines();
          loadRoles();
        }}
        onRunningChange={useCallback((running: boolean, progress: number) => {
          setAutoPilotRunning(running);
          setAutoPilotProgress(progress);
        }, [])}
      />

      {/* 合并导出弹窗 */}
      <Modal
        title="合并导出 MP3"
        open={mergeModalOpen}
        onCancel={() => setMergeModalOpen(false)}
        width={700}
        footer={
          mergeResults ? [
            <Button key="history" icon={<HistoryOutlined />} onClick={openMergeHistory}>历史记录</Button>,
            <Button key="close" onClick={() => setMergeModalOpen(false)}>关闭</Button>,
          ] : [
            <Button key="history" icon={<HistoryOutlined />} onClick={openMergeHistory}>历史记录</Button>,
            <Button key="cancel" onClick={() => setMergeModalOpen(false)}>取消</Button>,
            <Button key="ok" type="primary" loading={mergeLoading} onClick={handleMergeExport}>
              开始合并
            </Button>,
          ]
        }
        destroyOnClose
      >
        {mergeResults ? (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <Typography.Text type="success" strong>合并完成！共生成 {mergeResults.length} 个文件：</Typography.Text>
              <Space>
                <Checkbox checked={mergeZipIncludeSubtitles} onChange={(e) => setMergeZipIncludeSubtitles(e.target.checked)}>
                  <span style={{ fontSize: 12 }}>含字幕</span>
                </Checkbox>
                <Button
                  type="primary"
                  size="small"
                  icon={mergeZipLoading ? <LoadingOutlined /> : <CloudDownloadOutlined />}
                  loading={mergeZipLoading}
                  onClick={handleMergeZipDownload}
                >
                  一键打包 ZIP
                </Button>
                <Button
                  size="small"
                  icon={<DownloadOutlined />}
                  onClick={() => handleMergeLoadAll(false)}
                >
                  全部下载
                </Button>
                <Button
                  size="small"
                  icon={<FileTextOutlined />}
                  onClick={() => handleMergeLoadAll(true)}
                >
                  全部下载(含字幕)
                </Button>
              </Space>
            </div>
            <div style={{ maxHeight: 400, overflowY: 'auto' }}>
              {mergeResults.map((file, idx) => (
                <Card key={idx} size="small" style={{ marginBottom: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <Typography.Text strong>{file.name}</Typography.Text>
                      {file.duration && (
                        <Tag color="blue" style={{ marginLeft: 8 }}>{file.duration}</Tag>
                      )}
                      <br />
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        包含章节：{file.chapters.join('、')}
                      </Typography.Text>
                    </div>
                    <Space>
                      <Button
                        type="primary"
                        size="small"
                        icon={<DownloadOutlined />}
                        onClick={() => handleDownloadFile(file.url, file.name)}
                      >
                        音频
                      </Button>
                      {file.subtitles?.srt && (
                        <Button size="small" icon={<FileTextOutlined />} onClick={() => handleDownloadFile(file.subtitles!.srt, `${file.name.replace('.mp3', '')}.srt`)}>
                          SRT
                        </Button>
                      )}
                      {file.subtitles?.ass && (
                        <Button size="small" icon={<FileTextOutlined />} onClick={() => handleDownloadFile(file.subtitles!.ass, `${file.name.replace('.mp3', '')}.ass`)}>
                          ASS
                        </Button>
                      )}
                    </Space>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        ) : (
          <div>
            {/* 章节选择 */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <Typography.Text strong>选择章节：</Typography.Text>
                <Space size={8}>
                  <a onClick={() => handleMergeSelectAll(true)} style={{ fontSize: 12 }}>选中可见的</a>
                  <a onClick={() => handleMergeSelectAll(false)} style={{ fontSize: 12 }}>取消全选</a>
                </Space>
              </div>
              {/* 范围快捷选择 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, background: '#f5f5f5', borderRadius: 6, padding: '6px 10px' }}>
                <Typography.Text style={{ fontSize: 12, whiteSpace: 'nowrap' }}>从第</Typography.Text>
                <InputNumber
                  size="small"
                  min={1}
                  max={mergeLazyList.total || 1}
                  value={mergeRangeStart}
                  onChange={(v) => setMergeRangeStart(v ?? 1)}
                  style={{ width: 70 }}
                />
                <Typography.Text style={{ fontSize: 12, whiteSpace: 'nowrap' }}>章 到 第</Typography.Text>
                <InputNumber
                  size="small"
                  min={1}
                  max={mergeLazyList.total || 1}
                  value={mergeRangeEnd}
                  onChange={(v) => setMergeRangeEnd(v ?? mergeLazyList.total)}
                  style={{ width: 70 }}
                />
                <Typography.Text style={{ fontSize: 12, whiteSpace: 'nowrap' }}>章</Typography.Text>
                <Button
                  size="small"
                  type="primary"
                  loading={mergeRangeLoading}
                  onClick={handleMergeSelectRange}
                >
                  应用范围
                </Button>
              </div>
              <div
                ref={mergeLazyList.listRef as React.RefObject<HTMLDivElement>}
                onScroll={mergeLazyList.handleScroll}
                style={{ maxHeight: 240, overflowY: 'auto', border: '1px solid #d9d9d9', borderRadius: 6, padding: 8 }}
              >
                {mergeLazyList.hasLess && !mergeLazyList.loading && (
                  <div style={{ textAlign: 'center', padding: 4, color: '#585b70', fontSize: 11 }}>↑ 向上滚动加载更多</div>
                )}
                {mergeLazyList.chapters.map((ch, idx) => {
                  const globalIndex = mergeLazyList.offsetStart + idx + 1;
                  return (
                    <div key={ch.id} data-chapter-item style={{ padding: '4px 0' }}>
                      <Checkbox
                        checked={mergeSelectedChapters.includes(ch.id)}
                        onChange={(e) => handleMergeChapterToggle(ch.id, e.target.checked)}
                      >
                        <span style={{ color: '#585b70', fontSize: 11, marginRight: 4 }}>#{globalIndex}</span>
                        {ch.title}
                      </Checkbox>
                    </div>
                  );
                })}
                {mergeLazyList.loading && (
                  <div style={{ textAlign: 'center', padding: 8, color: '#585b70', fontSize: 11 }}>加载中...</div>
                )}
                {!mergeLazyList.loading && mergeLazyList.chapters.length === 0 && (
                  <Empty description="暂无章节" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                )}
                {!mergeLazyList.loading && !mergeLazyList.hasMore && mergeLazyList.chapters.length > 0 && (
                  <div style={{ textAlign: 'center', padding: 4, color: '#585b70', fontSize: 11 }}>已加载全部</div>
                )}
              </div>
              <Typography.Text type="secondary" style={{ fontSize: 12, marginTop: 4, display: 'block' }}>
                已选 {mergeSelectedChapters.length} / {mergeLazyList.total} 章
              </Typography.Text>
            </div>

            {/* 合并模式 */}
            <div style={{ marginBottom: 16 }}>
              <Typography.Text strong style={{ display: 'block', marginBottom: 8 }}>合并模式：</Typography.Text>
              <Radio.Group value={mergeMode} onChange={(e) => setMergeMode(e.target.value)}>
                <Radio value="all">全部合并为一个 MP3</Radio>
                <Radio value="group">
                  每
                  <InputNumber
                    min={1}
                    max={mergeSelectedChapters.length || 1}
                    value={mergeGroupSize}
                    onChange={(val) => setMergeGroupSize(val || 1)}
                    size="small"
                    style={{ width: 60, margin: '0 6px' }}
                    disabled={mergeMode !== 'group'}
                  />
                  章为一个 MP3
                </Radio>
                <Radio value="duration" style={{ marginTop: 8 }}>
                  每
                  <InputNumber
                    min={5}
                    max={180}
                    value={mergeDurationMinutes}
                    onChange={(val) => setMergeDurationMinutes(val || 30)}
                    size="small"
                    style={{ width: 70, margin: '0 6px' }}
                    disabled={mergeMode !== 'duration'}
                  />
                  分钟为一段
                  <Typography.Text type="secondary" style={{ fontSize: 11, marginLeft: 4 }}>
                    (以章节为界，不截断对话)
                  </Typography.Text>
                </Radio>
              </Radio.Group>
            </div>

            {/* 预览 */}
            {mergeSelectedChapters.length > 0 && (
              <div>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {mergeMode === 'all'
                    ? `将合并 ${mergeSelectedChapters.length} 个章节为 1 个 MP3 文件`
                    : mergeMode === 'group'
                    ? `将合并 ${mergeSelectedChapters.length} 个章节为 ${Math.ceil(mergeSelectedChapters.length / mergeGroupSize)} 个 MP3 文件`
                    : `将按 ${mergeDurationMinutes} 分钟为一段自动分割（章节不截断，允许略超时长）`
                  }
                </Typography.Text>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* 合并历史弹窗 */}
      <Modal
        title="合并导出历史"
        open={mergeHistoryModalOpen}
        onCancel={() => setMergeHistoryModalOpen(false)}
        width={640}
        footer={[
          mergeHistoryFiles.length > 0 && (
            <Button key="clear" danger onClick={handleClearMergeHistory}>一键清空</Button>
          ),
          <Button key="close" onClick={() => setMergeHistoryModalOpen(false)}>关闭</Button>,
        ].filter(Boolean)}
        destroyOnClose
      >
        {mergeHistoryLoading ? (
          <div style={{ textAlign: 'center', padding: 32 }}>
            <LoadingOutlined style={{ fontSize: 24 }} />
            <div style={{ marginTop: 8 }}>加载中...</div>
          </div>
        ) : mergeHistoryFiles.length === 0 ? (
          <Empty description="暂无合并历史" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <div style={{ maxHeight: 450, overflowY: 'auto' }}>
            {mergeHistoryFiles.map((file, idx) => (
              <Card key={idx} size="small" style={{ marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <Typography.Text strong>{file.name}</Typography.Text>
                    <Tag color="green" style={{ marginLeft: 8 }}>{file.size_mb} MB</Tag>
                    <br />
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      修改时间：{file.modified_time}
                    </Typography.Text>
                  </div>
                  <Space>
                    <Button
                      type="primary"
                      size="small"
                      icon={<DownloadOutlined />}
                      onClick={() => handleDownloadFile(file.url, file.name)}
                    >
                      音频
                    </Button>
                    {file.subtitles?.srt && (
                      <Button size="small" icon={<FileTextOutlined />} onClick={() => handleDownloadFile(file.subtitles!.srt, `${file.name.replace('.mp3', '')}.srt`)}>
                        SRT
                      </Button>
                    )}
                    {file.subtitles?.ass && (
                      <Button size="small" icon={<FileTextOutlined />} onClick={() => handleDownloadFile(file.subtitles!.ass, `${file.name.replace('.mp3', '')}.ass`)}>
                        ASS
                      </Button>
                    )}
                    <Button
                      danger
                      size="small"
                      icon={<DeleteOutlined />}
                      onClick={() => handleDeleteMergeHistoryFile(file.name)}
                    />
                  </Space>
                </div>
              </Card>
            ))}
          </div>
        )}
      </Modal>

      {/* 单章节导出结果弹窗 */}
      <Modal
        title="章节导出结果"
        open={chapterExportModalOpen}
        onCancel={() => setChapterExportModalOpen(false)}
        footer={[
          <Button key="close" onClick={() => setChapterExportModalOpen(false)}>关闭</Button>,
        ]}
        width={520}
        destroyOnClose
      >
        {chapterExportResult && (
          <div>
            <Typography.Text type="success" strong>
              「{chapterExportResult.chapter_title}」导出成功！
            </Typography.Text>
            <Tag color="blue" style={{ marginLeft: 8 }}>{chapterExportResult.duration}</Tag>
            <Divider style={{ margin: '12px 0' }} />

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <Card size="small">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Space>
                    <SoundOutlined style={{ color: '#52c41a' }} />
                    <Typography.Text>音频文件 (MP3)</Typography.Text>
                  </Space>
                  <Button
                    type="primary"
                    size="small"
                    icon={<DownloadOutlined />}
                    onClick={() => handleDownloadFile(chapterExportResult.audio_url, `${chapterExportResult.chapter_title}.mp3`)}
                  >
                    下载
                  </Button>
                </div>
              </Card>

              {chapterExportResult.subtitles?.srt && (
                <Card size="small">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Space>
                      <FileTextOutlined style={{ color: '#1890ff' }} />
                      <Typography.Text>SRT 字幕文件</Typography.Text>
                    </Space>
                    <Button
                      size="small"
                      icon={<DownloadOutlined />}
                      onClick={() => handleDownloadFile(chapterExportResult.subtitles!.srt, `${chapterExportResult.chapter_title}.srt`)}
                    >
                      下载
                    </Button>
                  </div>
                </Card>
              )}

              {chapterExportResult.subtitles?.ass && (
                <Card size="small">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Space>
                      <FileTextOutlined style={{ color: '#722ed1' }} />
                      <Typography.Text>ASS 字幕文件</Typography.Text>
                    </Space>
                    <Button
                      size="small"
                      icon={<DownloadOutlined />}
                      onClick={() => handleDownloadFile(chapterExportResult.subtitles!.ass, `${chapterExportResult.chapter_title}.ass`)}
                    >
                      下载
                    </Button>
                  </div>
                </Card>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* 项目设置 */}
      <Modal title="项目设置" open={settingsModalOpen} onOk={handleSaveSettings} onCancel={() => setSettingsModalOpen(false)} destroyOnClose width={520}>
        <Form form={settingsForm} layout="vertical">
          <Form.Item name="name" label="项目名称" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="description" label="项目描述">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item name="llm_provider_id" label="LLM 提供商">
            <Select
              allowClear
              options={llmProviders.map((p) => ({ value: p.id, label: p.name }))}
              onChange={(val) => {
                // 联动：切换 LLM 提供商时清空模型选择
                settingsForm.setFieldValue('llm_model', null);
                // 触发重渲染以更新模型下拉列表
                settingsForm.setFieldValue('llm_provider_id', val);
              }}
            />
          </Form.Item>
          <Form.Item noStyle shouldUpdate={(prev, cur) => prev.llm_provider_id !== cur.llm_provider_id}>
            {() => {
              const selectedProviderId = settingsForm.getFieldValue('llm_provider_id');
              const provider = llmProviders.find((p) => p.id === selectedProviderId);
              const models = provider?.model_list ? String(provider.model_list).split(',').map((m) => m.trim()).filter(Boolean) : [];
              return (
                <Form.Item name="llm_model" label="LLM 模型">
                  <Select
                    allowClear
                    placeholder={models.length > 0 ? '请选择模型' : '请先配置 LLM 提供商的模型列表'}
                    options={models.map((m) => ({ value: m, label: m }))}
                    disabled={models.length === 0}
                  />
                </Form.Item>
              );
            }}
          </Form.Item>
          <Form.Item name="tts_provider_id" label="TTS 引擎">
            <Select allowClear options={ttsProviders.map((p) => ({ value: p.id, label: p.name }))} />
          </Form.Item>
          <Form.Item name="language" label="语言" tooltip="指定文本语言，影响 TTS 文本预处理方式">
            <Select options={[{ value: 'zh', label: '🇨🇳 中文' }, { value: 'ja', label: '🇯🇵 日语' }]} />
          </Form.Item>
          <Form.Item name="prompt_id" label="提示词模板">
            <Select allowClear options={prompts.map((p) => ({ value: p.id, label: p.name }))} />
          </Form.Item>
          <Form.Item name="is_precise_fill" label="精准填充">
            <Select options={[{ value: 0, label: '关闭' }, { value: 1, label: '开启' }]} />
          </Form.Item>
          <Form.Item name="passerby_voice_pool" label="路人语音池" tooltip="选择用于路人角色随机分配的音色，未绑定音色的角色将从此池中随机获取">
            <Select
              mode="multiple"
              allowClear
              placeholder="选择音色加入路人语音池"
              options={voices.map((v) => ({ value: v.id, label: v.name }))}
              optionFilterProp="label"
              showSearch
            />
          </Form.Item>
        </Form>
      </Modal>
    </Layout>
  );
}
