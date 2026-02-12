import {
  ArrowLeftOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  ReloadOutlined,
  RobotOutlined,
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
  Col,
  Divider,
  Empty,
  Form,
  Input,
  Layout,
  message,
  Modal,
  Popconfirm,
  Progress,
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
import { useNavigate, useParams } from 'react-router-dom';
import { chapterApi, emotionApi, lineApi, llmProviderApi, projectApi, promptApi, roleApi, strengthApi, ttsProviderApi, voiceApi } from '../api';
import { useWebSocket } from '../hooks/useWebSocket';
import type { Chapter, Emotion, Line, LLMProvider, Project, Prompt, Role, Strength, TTSProvider, Voice, WSEvent } from '../types';

const { Sider, Content } = Layout;
const { Title, Text } = Typography;

export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const projectId = Number(id);
  const navigate = useNavigate();
  const { subscribe } = useWebSocket();

  // ==================== 项目数据 ====================
  const [project, setProject] = useState<Project | null>(null);

  // ==================== 章节数据 ====================
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [activeChapterId, setActiveChapterId] = useState<number | null>(null);
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

  // ==================== 音色数据 ====================
  const [voices, setVoices] = useState<Voice[]>([]);
  const [roleVoiceMap, setRoleVoiceMap] = useState<Record<number, number>>({});

  // ==================== 情绪 & 强度 ====================
  const [emotions, setEmotions] = useState<Emotion[]>([]);
  const [strengths, setStrengths] = useState<Strength[]>([]);

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

  // ==================== 播放状态 ====================
  const audioRef = useRef(new Audio());
  const [playingLineId, setPlayingLineId] = useState<number | null>(null);
  const [playingVoiceId, setPlayingVoiceId] = useState<number | null>(null);

  // ==================== 队列状态 ====================
  const [queueRestSize, setQueueRestSize] = useState(0);
  const [activeTab, setActiveTab] = useState('lines');

  // ==================== 计算值 ====================
  const currentChapter = useMemo(() => chapters.find((c) => c.id === activeChapterId) || null, [chapters, activeChapterId]);
  const currentChapterContent = currentChapter?.text_content || '';

  const filteredChapters = useMemo(() => {
    const kw = chapterKeyword.trim().toLowerCase();
    return chapters.filter((c) => c.title.toLowerCase().includes(kw));
  }, [chapters, chapterKeyword]);

  const displayedLines = useMemo(() => {
    const kw = lineKeyword.trim().toLowerCase();
    return lines
      .filter((l) => (!roleFilter ? true : l.role_id === roleFilter))
      .filter((l) => (l.text_content || '').toLowerCase().includes(kw))
      .filter((l) => (!statusFilter ? true : l.status === statusFilter));
  }, [lines, lineKeyword, roleFilter, statusFilter]);

  const displayedRoles = useMemo(() => {
    const kw = roleKeyword.trim().toLowerCase();
    return roles.filter((r) => r.name.toLowerCase().includes(kw));
  }, [roles, roleKeyword]);

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

  const loadChapters = useCallback(async () => {
    const res = await chapterApi.getByProject(projectId);
    if (res.data) setChapters(res.data);
    else setChapters([]);
  }, [projectId]);

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
  }, [projectId]);

  const loadVoices = useCallback(async () => {
    const res = await voiceApi.getAll(project?.tts_provider_id ?? undefined);
    if (res.data) setVoices(res.data);
    else setVoices([]);
  }, [project?.tts_provider_id]);

  const loadEnums = useCallback(async () => {
    const [emoRes, strRes] = await Promise.all([emotionApi.getAll(), strengthApi.getAll()]);
    if (emoRes.data) setEmotions(emoRes.data);
    if (strRes.data) setStrengths(strRes.data);
  }, []);

  // ==================== 初始化 ====================
  useEffect(() => {
    if (projectId) {
      loadProject();
      loadChapters();
      loadRoles();
      loadEnums();
    }
  }, [projectId]);

  useEffect(() => {
    if (project) loadVoices();
  }, [project?.tts_provider_id]);

  useEffect(() => {
    loadLines();
  }, [activeChapterId]);

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
    ];
    return () => unsubs.forEach((fn) => fn());
  }, [subscribe]);

  // 音频播放事件
  useEffect(() => {
    const audio = audioRef.current;
    const onEnded = () => { setPlayingLineId(null); setPlayingVoiceId(null); };
    audio.addEventListener('ended', onEnded);
    return () => audio.removeEventListener('ended', onEnded);
  }, []);

  // ==================== 章节操作 ====================
  const handleSelectChapter = (chapter: Chapter) => {
    setActiveChapterId(chapter.id);
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
      loadChapters();
    } catch {
      // 校验失败
    }
  };

  const handleDeleteChapter = async (chapterId: number) => {
    await chapterApi.delete(chapterId);
    message.success('已删除章节');
    if (activeChapterId === chapterId) setActiveChapterId(null);
    loadChapters();
  };

  const openRenameChapter = (chapter: Chapter) => {
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
          loadChapters();
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
    const src = `/lines/audio-file?path=${encodeURIComponent(row.audio_path)}`;
    audio.src = src;
    audio.currentTime = 0;
    setPlayingLineId(row.id);
    setPlayingVoiceId(null);
    audio.play().catch(() => message.error('无法播放音频'));
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
    audio.src = `/voices/audio-file?path=${encodeURIComponent(voice.reference_path)}`;
    audio.currentTime = 0;
    setPlayingVoiceId(voiceId);
    setPlayingLineId(null);
    audio.play().catch(() => message.error('无法播放'));
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
      render: (roleId: number, record: Line) => (
        <div>
          <Select
            size="small"
            value={roleId || undefined}
            style={{ width: '100%' }}
            placeholder="选择角色"
            allowClear
            showSearch
            optionFilterProp="label"
            options={roles.map((r) => ({ value: r.id, label: r.name }))}
            onChange={(val) => handleUpdateLineField(record.id, 'role_id', val || null)}
          />
          <Tag color={getRoleVoiceName(roleId) ? 'green' : 'default'} style={{ marginTop: 4, fontSize: 11 }}>
            {getRoleVoiceName(roleId) || '未绑定音色'}
          </Tag>
        </div>
      ),
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
      width: 110,
      render: (emotionId: number, record: Line) => (
        <Select
          size="small"
          value={emotionId || undefined}
          style={{ width: '100%' }}
          placeholder="情绪"
          allowClear
          options={emotions.map((e) => ({ value: e.id, label: e.name }))}
          onChange={(val) => handleUpdateLineField(record.id, 'emotion_id', val || null)}
        />
      ),
    },
    {
      title: '强度',
      dataIndex: 'strength_id',
      key: 'strength_id',
      width: 110,
      render: (strengthId: number, record: Line) => (
        <Select
          size="small"
          value={strengthId || undefined}
          style={{ width: '100%' }}
          placeholder="强度"
          allowClear
          options={strengths.map((s) => ({ value: s.id, label: s.name }))}
          onChange={(val) => handleUpdateLineField(record.id, 'strength_id', val || null)}
        />
      ),
    },
    {
      title: '试听',
      key: 'audio',
      width: 60,
      render: (_: unknown, record: Line) =>
        record.audio_path && record.status === 'done' ? (
          <Button
            type="text"
            icon={playingLineId === record.id ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
            onClick={() => handlePlayLine(record)}
            style={{ color: playingLineId === record.id ? '#f5222d' : '#52c41a' }}
          />
        ) : null,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 80,
      render: (status: string) => <Tag color={statusType(status)}>{statusText(status)}</Tag>,
    },
    {
      title: '操作',
      key: 'actions',
      width: 200,
      render: (_: unknown, record: Line) => (
        <Space size={4} wrap>
          <Button size="small" type="primary" disabled={!canGenerate(record)} onClick={() => handleGenerateOne(record)}>
            生成
          </Button>
          <Button size="small" onClick={() => handleInsertBelow(record)}>插入</Button>
          <Popconfirm title="确认删除？" onConfirm={() => handleDeleteLine(record)}>
            <Button size="small" danger>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  // ==================== 渲染 ====================
  return (
    <Layout style={{ background: 'transparent', height: '100%' }}>
      {/* ==================== 左侧章节面板 ==================== */}
      <Sider
        width={260}
        style={{ background: '#1e1e2e', borderRight: '1px solid #313244', borderRadius: 8, marginRight: 16, display: 'flex', flexDirection: 'column' }}
      >
        {/* 顶部：返回 + 项目名 */}
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #313244' }}>
          <Space>
            <Button type="text" icon={<ArrowLeftOutlined />} onClick={() => navigate('/projects')} style={{ color: '#cdd6f4' }} />
            <Text strong style={{ color: '#cdd6f4', fontSize: 15 }}>{project?.name || '项目'}</Text>
          </Space>
          <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Tag>章节 {chapters.length}</Tag>
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
            placeholder="搜索章节"
            allowClear
            value={chapterKeyword}
            onChange={(e) => setChapterKeyword(e.target.value)}
          />
        </div>

        {/* 章节列表 */}
        <div style={{ flex: 1, overflow: 'auto', padding: '0 8px 8px' }}>
          {filteredChapters.map((ch) => (
            <Card
              key={ch.id}
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
          {filteredChapters.length === 0 && (
            <div style={{ textAlign: 'center', padding: 20, color: '#6c7086' }}>
              <Text type="secondary">暂无章节</Text>
            </div>
          )}
        </div>
      </Sider>

      {/* ==================== 右侧内容区 ==================== */}
      <Content style={{ display: 'flex', flexDirection: 'column', gap: 12, overflow: 'auto' }}>
        {!activeChapterId ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Empty description="请从左侧选择一个章节" />
          </div>
        ) : (
          <>
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
                    icon={<UploadOutlined />}
                    onClick={() => { setThirdJsonText(''); setImportThirdModal(true); }}
                  >
                    导入JSON
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
            <Card size="small" style={{ background: '#1e1e2e', borderColor: '#313244', flex: 1, display: 'flex', flexDirection: 'column' }} bodyStyle={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 0 }}>
              <Tabs
                activeKey={activeTab}
                onChange={setActiveTab}
                style={{ flex: 1, display: 'flex', flexDirection: 'column' }}
                tabBarStyle={{ padding: '0 16px' }}
                items={[
                  {
                    key: 'lines',
                    label: `台词管理 (${lines.length})`,
                    children: (
                      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '0 16px 16px' }}>
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
                          <Button size="small" type="default" icon={<DownloadOutlined />} onClick={handleExport} style={{ background: '#52c41a', color: '#fff', borderColor: '#52c41a' }}>
                            导出
                          </Button>
                        </div>

                        {/* 台词表格 */}
                        <Table
                          dataSource={displayedLines}
                          columns={lineColumns}
                          rowKey="id"
                          size="small"
                          pagination={false}
                          scroll={{ y: 'calc(100vh - 480px)' }}
                          style={{ flex: 1 }}
                        />
                      </div>
                    ),
                  },
                  {
                    key: 'roles',
                    label: `角色库 (${roles.length})`,
                    children: (
                      <div style={{ padding: '0 16px 16px' }}>
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
          </>
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
                  style={{ cursor: 'pointer' }}
                  onClick={() => voiceModalRole && handleBindVoice(voiceModalRole, v.id)}
                >
                  <div style={{ marginBottom: 8 }}>
                    <Text strong>{v.name}</Text>
                    <div style={{ marginTop: 4 }}>
                      {v.description?.split(',').map((tag, i) => (
                        <Tag key={i} style={{ marginBottom: 4 }}>{tag.trim()}</Tag>
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
          <Form.Item name="llm_model" label="LLM 模型" dependencies={['llm_provider_id']}>
            {(() => {
              const selectedProviderId = settingsForm.getFieldValue('llm_provider_id');
              const provider = llmProviders.find((p) => p.id === selectedProviderId);
              const models = provider?.model_list ? String(provider.model_list).split(',').map((m) => m.trim()).filter(Boolean) : [];
              return models.length > 0 ? (
                <Select allowClear placeholder="请选择模型" options={models.map((m) => ({ value: m, label: m }))} />
              ) : (
                <Input placeholder="请先配置 LLM 提供商的模型列表" />
              );
            })()}
          </Form.Item>
          <Form.Item name="tts_provider_id" label="TTS 引擎">
            <Select allowClear options={ttsProviders.map((p) => ({ value: p.id, label: p.name }))} />
          </Form.Item>
          <Form.Item name="prompt_id" label="提示词模板">
            <Select allowClear options={prompts.map((p) => ({ value: p.id, label: p.name }))} />
          </Form.Item>
          <Form.Item name="is_precise_fill" label="精准填充">
            <Select options={[{ value: 0, label: '关闭' }, { value: 1, label: '开启' }]} />
          </Form.Item>
        </Form>
      </Modal>
    </Layout>
  );
}
