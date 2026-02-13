import { PauseCircleOutlined, PlayCircleOutlined, RocketOutlined, StopOutlined, UserSwitchOutlined } from '@ant-design/icons';
import { Alert, Badge, Checkbox, InputNumber, Modal, Progress, Slider, Space, Switch, Tag, Typography, message } from 'antd';
import { useCallback, useEffect, useRef, useState } from 'react';
import { batchApi, chapterApi, roleApi } from '../api';
import { useChapterLazyList } from '../hooks/useChapterLazyList';
import { usePersistedConfig } from '../hooks/usePersistedState';
import { useWebSocket } from '../hooks/useWebSocket';
import type { Role, WSEvent } from '../types';
import LogPanel from './LogPanel';

const { Text } = Typography;

interface AutoPilotModalProps {
  open: boolean;
  onClose: () => void;
  projectId: number;
  onComplete?: () => void;
  /** 运行状态通知父组件 */
  onRunningChange?: (running: boolean, progress: number) => void;
}

type AutopilotPhase = 'idle' | 'llm' | 'voice_match' | 'tts' | 'pipeline' | 'paused' | 'voice_needed' | 'done' | 'cancelled';

interface ChapterStatus {
  id: number;
  title: string;
  status: 'pending' | 'llm' | 'llm_done' | 'llm_error' | 'tts' | 'tts_done' | 'tts_error' | 'skipped';
}

export default function AutoPilotModal({ open, onClose, projectId, onComplete, onRunningChange }: AutoPilotModalProps) {
  const { subscribe } = useWebSocket();
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [phase, setPhase] = useState<AutopilotPhase>('idle');
  const [llmDone, setLlmDone] = useState(0);
  const [ttsDone, setTtsDone] = useState(0);
  const [total, setTotal] = useState(0);
  const [chapterStatuses, setChapterStatuses] = useState<Map<number, ChapterStatus>>(new Map());

  // 使用持久化配置（并发数、语速、音色匹配间隔、手动分配、范围）
  const [persistedConfig, updateConfig] = usePersistedConfig(
    `saybook_autopilot_${projectId}`,
    { concurrency: 1, speed: 1.0, voiceMatchInterval: 10, manualVoiceAssign: false, rangeStart: 1, rangeEnd: 0 }
  );
  const concurrency = persistedConfig.concurrency;
  const speed = persistedConfig.speed;
  const voiceMatchInterval = persistedConfig.voiceMatchInterval;
  const manualVoiceAssign = persistedConfig.manualVoiceAssign;
  const setConcurrency = (v: number) => updateConfig('concurrency', v);
  const setSpeed = (v: number) => updateConfig('speed', v);
  const setVoiceMatchInterval = (v: number) => updateConfig('voiceMatchInterval', v);
  const setManualVoiceAssign = (v: boolean) => updateConfig('manualVoiceAssign', v);

  // 音色分配暂停界面
  const [unboundRoles, setUnboundRoles] = useState<string[]>([]);
  const [unboundChapterId, setUnboundChapterId] = useState<number | null>(null);

  // 角色列表（用于音色分配界面）
  const [roles, setRoles] = useState<Role[]>([]);

  const hasInitRef = useRef(false);
  const lazyList = useChapterLazyList({ projectId });

  // 计算总进度百分比
  const overallProgress = total > 0 ? Math.round(((llmDone + ttsDone) / (total * 2)) * 100) : 0;

  // 通知父组件
  useEffect(() => {
    onRunningChange?.(running, overallProgress);
  }, [running, overallProgress, onRunningChange]);

  // 弹窗打开时初始化
  useEffect(() => {
    if (open) {
      lazyList.init();

      if (!running) {
        // 检查后台是否有运行中的任务
        batchApi.autopilotStatus(projectId).then((res) => {
          if (res.code === 200 && res.data?.running) {
            setRunning(true);
            setPaused(res.data.paused || false);
            if (res.data.paused) {
              setPhase('paused');
            }
            if (logs.length === 0) {
              setLogs(['🔄 检测到后台有正在运行的挂机任务，已恢复监听...']);
            }
          } else if (!hasInitRef.current) {
            _resetState();
            hasInitRef.current = true;
          }
        }).catch(() => {
          if (!hasInitRef.current) {
            _resetState();
            hasInitRef.current = true;
          }
        });
      }
    }
  }, [open, projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  const _resetState = () => {
    setLogs([]);
    setPhase('idle');
    setLlmDone(0);
    setTtsDone(0);
    setTotal(0);
    setCancelling(false);
    setPaused(false);
    setChapterStatuses(new Map());
    setSelectedIds([]);
    setUnboundRoles([]);
    setUnboundChapterId(null);
  };

  // 加载章节后自动选中
  useEffect(() => {
    if (open && lazyList.chapters.length > 0 && hasInitRef.current && selectedIds.length === 0 && !running) {
      const validIds = lazyList.chapters.filter((c) => c.has_content).map((c) => c.id);
      setSelectedIds(prev => {
        const combined = new Set([...prev, ...validIds]);
        return Array.from(combined);
      });
    }
  }, [lazyList.chapters]); // eslint-disable-line react-hooks/exhaustive-deps

  // 加载角色列表（用于音色分配界面）
  const loadRoles = useCallback(async () => {
    try {
      const res = await roleApi.getByProject(projectId);
      if (res.code === 200 && res.data) {
        setRoles(res.data);
      }
    } catch { /* ignore */ }
  }, [projectId]);

  // WebSocket 事件监听
  useEffect(() => {
    const unsubs = [
      subscribe('autopilot_start', (data: WSEvent) => {
        if (data.project_id !== projectId) return;
        setLogs(prev => [...prev, data.log as string]);
        setPhase('llm');
      }),
      subscribe('autopilot_progress', (data: WSEvent) => {
        if (data.project_id !== projectId) return;
        setLogs(prev => [...prev, data.log as string]);
        setLlmDone(data.llm_done as number);
        setTtsDone(data.tts_done as number);
        setTotal(data.total as number);

        const chapterId = data.chapter_id as number;
        const p = data.phase as string;
        setChapterStatuses(prev => {
          const next = new Map(prev);
          const existing = next.get(chapterId);
          let status: ChapterStatus['status'] = 'pending';
          if (p === 'llm') status = 'llm';
          else if (p === 'llm_done') status = 'llm_done';
          else if (p === 'llm_error') status = 'llm_error';
          else if (p === 'tts') status = 'tts';
          else if (p === 'tts_done') status = 'tts_done';
          else if (p === 'tts_error') status = 'tts_error';
          next.set(chapterId, {
            id: chapterId,
            title: existing?.title || `章节 ${chapterId}`,
            status,
          });
          return next;
        });

        // 并行流水线模式：如果 LLM 和 TTS 同时在运行，显示 pipeline 阶段
        setPhase(prev => {
          const isLlmEvent = p === 'llm' || p === 'llm_done' || p === 'llm_error';
          const isTtsEvent = p === 'tts' || p === 'tts_done' || p === 'tts_error';
          if (isLlmEvent && (prev === 'tts' || prev === 'pipeline')) return 'pipeline';
          if (isTtsEvent && (prev === 'llm' || prev === 'pipeline')) return 'pipeline';
          if (isLlmEvent) return 'llm';
          if (isTtsEvent) return 'tts';
          return prev;
        });
      }),
      subscribe('autopilot_llm_progress', (data: WSEvent) => {
        if (data.project_id !== projectId) return;
        setLogs(prev => [...prev, data.log as string]);
      }),
      subscribe('autopilot_llm_log', (data: WSEvent) => {
        if (data.project_id !== projectId) return;
        setLogs(prev => [...prev, data.log as string]);
      }),
      subscribe('autopilot_tts_chapter_start', (data: WSEvent) => {
        if (data.project_id !== projectId) return;
        setLogs(prev => [...prev, data.log as string]);
      }),
      subscribe('autopilot_tts_chapter_done', (data: WSEvent) => {
        if (data.project_id !== projectId) return;
        setLogs(prev => [...prev, data.log as string]);
      }),
      subscribe('autopilot_tts_line', (data: WSEvent) => {
        if (data.project_id !== projectId) return;
        setLogs(prev => [...prev, data.log as string]);
      }),
      subscribe('autopilot_tts_log', (data: WSEvent) => {
        if (data.project_id !== projectId) return;
        setLogs(prev => [...prev, data.log as string]);
      }),
      subscribe('autopilot_log', (data: WSEvent) => {
        if (data.project_id !== projectId) return;
        setLogs(prev => [...prev, data.log as string]);
      }),
      subscribe('autopilot_voice_matched', (data: WSEvent) => {
        if (data.project_id !== projectId) return;
        setLogs(prev => [...prev, data.log as string]);
        setPhase('voice_match');
      }),
      subscribe('autopilot_voice_needed', (data: WSEvent) => {
        if (data.project_id !== projectId) return;
        setLogs(prev => [...prev, data.log as string]);
        setPhase('voice_needed');
        setPaused(true);
        setUnboundRoles((data.unbound_roles as string[]) || []);
        setUnboundChapterId(data.chapter_id as number);
        // 加载最新角色列表
        loadRoles();
      }),
      subscribe('autopilot_paused', (data: WSEvent) => {
        if (data.project_id !== projectId) return;
        setLogs(prev => [...prev, data.log as string]);
        setPaused(true);
        setPhase('paused');
      }),
      subscribe('autopilot_resumed', (data: WSEvent) => {
        if (data.project_id !== projectId) return;
        setLogs(prev => [...prev, data.log as string]);
        setPaused(false);
        setPhase('llm');
      }),
      subscribe('autopilot_complete', (data: WSEvent) => {
        if (data.project_id !== projectId) return;
        setLogs(prev => [...prev, data.log as string]);
        setLlmDone(data.llm_done as number);
        setTtsDone(data.tts_done as number);
        setRunning(false);
        setPaused(false);
        setCancelling(false);
        hasInitRef.current = false;
        if (data.cancelled) {
          setPhase('cancelled');
          message.warning('一键挂机已取消');
        } else {
          setPhase('done');
          message.success('一键挂机全部完成！');
        }
        onComplete?.();
      }),
    ];

    return () => unsubs.forEach(fn => fn());
  }, [subscribe, projectId, onComplete, loadRoles]);

  // 启动
  const handleStart = useCallback(async () => {
    if (selectedIds.length === 0) {
      message.warning('请先选择要处理的章节');
      return;
    }
    setRunning(true);
    setPaused(false);
    setCancelling(false);
    setPhase('llm');
    setLogs([`🚀 一键挂机启动，共 ${selectedIds.length} 章，并发数 ${concurrency}，语速 ${speed}x`]);
    setLlmDone(0);
    setTtsDone(0);
    setTotal(selectedIds.length);
    setUnboundRoles([]);
    setUnboundChapterId(null);

    setChapterStatuses(prev => {
      const next = new Map(prev);
      selectedIds.forEach(id => {
        const existing = next.get(id);
        if (existing) next.set(id, { ...existing, status: 'pending' });
      });
      return next;
    });

    try {
      const res = await batchApi.autopilotStart({
        project_id: projectId,
        chapter_ids: selectedIds,
        concurrency,
        speed,
        voice_match_interval: voiceMatchInterval,
        manual_voice_assign: manualVoiceAssign,
      });
      if (res.code !== 200) {
        message.error(res.message || '启动失败');
        setRunning(false);
        setPhase('idle');
      }
    } catch {
      message.error('请求失败');
      setRunning(false);
      setPhase('idle');
    }
  }, [selectedIds, projectId, concurrency, speed, voiceMatchInterval, manualVoiceAssign]);

  // 暂停
  const handlePause = useCallback(async () => {
    try {
      const res = await batchApi.autopilotPause(projectId);
      if (res.code === 200) {
        message.info('暂停信号已发送');
      }
    } catch {
      message.error('暂停请求失败');
    }
  }, [projectId]);

  // 继续
  const handleResume = useCallback(async () => {
    try {
      const res = await batchApi.autopilotResume(projectId);
      if (res.code === 200) {
        setPaused(false);
        setPhase('llm');
        setUnboundRoles([]);
        setUnboundChapterId(null);
        message.success('任务已继续');
      }
    } catch {
      message.error('继续请求失败');
    }
  }, [projectId]);

  // 取消
  const handleCancel = useCallback(async () => {
    setCancelling(true);
    setLogs(prev => [...prev, '⏳ 正在取消任务...']);
    try {
      const res = await batchApi.autopilotCancel(projectId);
      if (res.code === 200) {
        message.info('取消信号已发送');
      } else {
        setCancelling(false);
      }
    } catch {
      message.error('取消请求失败');
      setCancelling(false);
    }
  }, [projectId]);

  // 范围选择（从持久化配置中读取）
  const rangeStart = persistedConfig.rangeStart;
  const rangeEnd = persistedConfig.rangeEnd || lazyList.total || 1;
  const setRangeStart = (v: number) => updateConfig('rangeStart', v);
  const setRangeEnd = (v: number) => updateConfig('rangeEnd', v);
  const [rangeLoading, setRangeLoading] = useState(false);

  // 仅当持久化中没有保存过范围（rangeEnd 为 0）时，设置默认值
  useEffect(() => {
    if (open && lazyList.total > 0 && persistedConfig.rangeEnd === 0) {
      updateConfig('rangeEnd', lazyList.total);
    }
  }, [open, lazyList.total]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSelectRange = useCallback(async () => {
    const start = Math.max(1, rangeStart);
    const end = Math.min(lazyList.total, rangeEnd);
    if (start > end) {
      message.warning('起始章节不能大于结束章节');
      return;
    }
    setRangeLoading(true);
    try {
      const res = await chapterApi.getIdsByRange(projectId, { start, end, has_content_only: true });
      if (res.data && res.data.length > 0) {
        setSelectedIds(res.data);
        message.success(`已选中第 ${start} ~ ${end} 章中 ${res.data.length} 个有内容的章节`);
      } else {
        setSelectedIds([]);
        message.warning(`第 ${start} ~ ${end} 章中没有有内容的章节`);
      }
      lazyList.reset();
      await lazyList.jumpToIndex(start);
    } catch {
      message.error('获取范围章节失败');
    } finally {
      setRangeLoading(false);
    }
  }, [rangeStart, rangeEnd, lazyList, projectId]);

  // 阶段颜色与标签
  const phaseConfig: Record<string, { color: string; label: string }> = {
    idle: { color: '#585b70', label: '就绪' },
    llm: { color: '#6366f1', label: 'LLM 解析中' },
    voice_match: { color: '#f59e0b', label: '音色匹配中' },
    tts: { color: '#52c41a', label: 'TTS 配音中' },
    pipeline: { color: '#818cf8', label: 'LLM + TTS 并行中' },
    paused: { color: '#f59e0b', label: '已暂停' },
    voice_needed: { color: '#ef4444', label: '需要分配音色' },
    done: { color: '#52c41a', label: '已完成' },
    cancelled: { color: '#585b70', label: '已取消' },
  };

  const chapterStatusColor: Record<string, string> = {
    pending: 'default',
    llm: 'processing',
    llm_done: 'blue',
    llm_error: 'error',
    tts: 'processing',
    tts_done: 'success',
    tts_error: 'warning',
    skipped: 'warning',
  };

  const chapterStatusLabel: Record<string, string> = {
    pending: '待处理',
    llm: 'LLM中',
    llm_done: 'LLM完成',
    llm_error: 'LLM失败',
    tts: 'TTS中',
    tts_done: '完成',
    tts_error: 'TTS失败',
    skipped: '已跳过',
  };

  return (
    <Modal
      title={
        <Space>
          <RocketOutlined />
          <span>一键挂机</span>
          {running && (
            <Badge
              status={paused ? 'warning' : 'processing'}
              text={<Text style={{ color: phaseConfig[phase]?.color, fontSize: 12 }}>{phaseConfig[phase]?.label}</Text>}
            />
          )}
        </Space>
      }
      open={open}
      onCancel={onClose}
      closable={true}
      maskClosable={!running}
      width={900}
      footer={
        <Space>
          <button
            onClick={onClose}
            style={{
              padding: '6px 16px',
              background: 'transparent',
              border: '1px solid #313244',
              borderRadius: 6,
              color: '#cdd6f4',
              cursor: 'pointer',
            }}
          >
            {running ? '后台运行' : '关闭'}
          </button>
          {running && !paused && (
            <button
              onClick={handlePause}
              style={{
                padding: '6px 16px',
                background: '#f59e0b',
                border: 'none',
                borderRadius: 6,
                color: '#fff',
                cursor: 'pointer',
                fontWeight: 500,
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <PauseCircleOutlined />
              暂停
            </button>
          )}
          {running && paused && (
            <button
              onClick={handleResume}
              style={{
                padding: '6px 16px',
                background: '#52c41a',
                border: 'none',
                borderRadius: 6,
                color: '#fff',
                cursor: 'pointer',
                fontWeight: 500,
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <PlayCircleOutlined />
              继续
            </button>
          )}
          {running && (
            <button
              onClick={handleCancel}
              disabled={cancelling}
              style={{
                padding: '6px 16px',
                background: cancelling ? '#45475a' : '#ef4444',
                border: 'none',
                borderRadius: 6,
                color: '#fff',
                cursor: cancelling ? 'not-allowed' : 'pointer',
                fontWeight: 500,
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <StopOutlined />
              {cancelling ? '取消中...' : '取消任务'}
            </button>
          )}
          {!running && (
            <button
              onClick={handleStart}
              disabled={selectedIds.length === 0}
              style={{
                padding: '6px 16px',
                background: selectedIds.length === 0 ? '#45475a' : '#6366f1',
                border: 'none',
                borderRadius: 6,
                color: '#fff',
                cursor: selectedIds.length === 0 ? 'not-allowed' : 'pointer',
                fontWeight: 500,
              }}
            >
              🚀 开始挂机 ({selectedIds.length} 章)
            </button>
          )}
        </Space>
      }
    >
      {/* ---- 音色分配警告区域 ---- */}
      {phase === 'voice_needed' && unboundRoles.length > 0 && (
        <Alert
          type="warning"
          showIcon
          icon={<UserSwitchOutlined />}
          style={{ marginBottom: 16, background: '#332800', borderColor: '#f59e0b' }}
          message={
            <span style={{ color: '#f59e0b', fontWeight: 600 }}>
              需要手动分配音色
            </span>
          }
          description={
            <div>
              <div style={{ color: '#cdd6f4', marginBottom: 8 }}>
                以下角色未绑定音色，请到 <strong>角色库</strong> Tab 分配后点击"继续"：
              </div>
              <Space wrap>
                {unboundRoles.map(name => (
                  <Tag key={name} color="warning" style={{ fontSize: 13 }}>{name}</Tag>
                ))}
              </Space>
              {unboundChapterId && (
                <div style={{ color: '#585b70', marginTop: 8, fontSize: 12 }}>
                  来自章节 ID: {unboundChapterId}
                </div>
              )}
            </div>
          }
        />
      )}

      {/* ---- 进度总览 ---- */}
      {running && (
        <div style={{ marginBottom: 16, background: '#181825', borderRadius: 8, padding: 12, border: '1px solid #313244' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <Text style={{ color: '#a6adc8', fontSize: 12 }}>
              总进度: LLM {llmDone}/{total} | TTS {ttsDone}/{total}
            </Text>
            <Tag color={phaseConfig[phase]?.color}>{phaseConfig[phase]?.label}</Tag>
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <Text style={{ color: '#585b70', fontSize: 11 }}>LLM 解析</Text>
              <Progress
                percent={total > 0 ? Math.round((llmDone / total) * 100) : 0}
                size="small"
                strokeColor="#6366f1"
                status={paused ? 'exception' : 'active'}
                format={() => `${llmDone}/${total}`}
              />
            </div>
            <div style={{ flex: 1 }}>
              <Text style={{ color: '#585b70', fontSize: 11 }}>TTS 配音</Text>
              <Progress
                percent={total > 0 ? Math.round((ttsDone / total) * 100) : 0}
                size="small"
                strokeColor="#52c41a"
                status={paused ? 'exception' : 'active'}
                format={() => `${ttsDone}/${total}`}
              />
            </div>
          </div>
        </div>
      )}

      {/* ---- 配置参数 ---- */}
      {!running && (
        <div style={{ marginBottom: 16, background: '#181825', borderRadius: 8, padding: 12, border: '1px solid #313244' }}>
          <Text strong style={{ color: '#cdd6f4', display: 'block', marginBottom: 12 }}>⚙️ 挂机配置</Text>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 24px' }}>
            {/* LLM并发数 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Text style={{ color: '#a6adc8', fontSize: 12, whiteSpace: 'nowrap' }}>LLM并发数</Text>
              <InputNumber
                size="small"
                min={1}
                max={10}
                value={concurrency}
                onChange={v => setConcurrency(v ?? 1)}
                style={{ width: 80 }}
              />
              <Text style={{ color: '#585b70', fontSize: 11 }}>(1~10)</Text>
            </div>

            {/* 音色匹配间隔 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Text style={{ color: '#a6adc8', fontSize: 12, whiteSpace: 'nowrap' }}>音色匹配间隔</Text>
              <InputNumber
                size="small"
                min={1}
                max={100}
                value={voiceMatchInterval}
                onChange={v => setVoiceMatchInterval(v ?? 10)}
                style={{ width: 80 }}
              />
              <Text style={{ color: '#585b70', fontSize: 11 }}>章</Text>
            </div>

            {/* 手动分配音色 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Text style={{ color: '#a6adc8', fontSize: 12, whiteSpace: 'nowrap' }}>手动分配音色</Text>
              <Switch
                size="small"
                checked={manualVoiceAssign}
                onChange={setManualVoiceAssign}
              />
              <Text style={{ color: '#585b70', fontSize: 11 }}>
                {manualVoiceAssign ? '每次新角色暂停' : '自动智能匹配'}
              </Text>
            </div>

            {/* 全局语速 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Text style={{ color: '#a6adc8', fontSize: 12, whiteSpace: 'nowrap' }}>全局语速</Text>
              <Slider
                min={0.5}
                max={2.0}
                step={0.1}
                value={speed}
                onChange={setSpeed}
                style={{ flex: 1 }}
                marks={{ 0.5: '0.5x', 1.0: '1x', 2.0: '2x' }}
              />
            </div>
          </div>

          <div style={{ marginTop: 8, padding: '6px 10px', background: '#11111b', borderRadius: 6, fontSize: 11, color: '#585b70', lineHeight: 1.6 }}>
            💡 <strong>流水线模式</strong>：LLM解析 和 TTS配音 <strong style={{ color: '#818cf8' }}>并行运行</strong>，LLM完成一章即可立即开始该章配音，无需等待所有LLM完成<br/>
            💡 <strong>音色匹配</strong>：每 {voiceMatchInterval} 章检查未绑定角色 →
            {manualVoiceAssign ? ' 暂停等待手动分配' : ' 自动智能匹配（失败则暂停）'}<br/>
            💡 <strong>暂停</strong>：点击暂停后，当前章节处理完才会停下<br/>
            💡 <strong>音色</strong>：如某章存在未绑定音色的角色，该章会跳过配音
          </div>
        </div>
      )}

      {/* ---- 章节选择 ---- */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <Text strong style={{ color: '#cdd6f4' }}>选择章节范围</Text>
          <Space size={8}>
            <a onClick={() => {
              const validIds = lazyList.chapters.filter(c => c.has_content).map(c => c.id);
              setSelectedIds(prev => Array.from(new Set([...prev, ...validIds])));
            }} style={{ fontSize: 12 }}>选中可见的</a>
            <a onClick={() => setSelectedIds([])} style={{ fontSize: 12 }}>取消全选</a>
          </Space>
        </div>
        {/* 范围快捷选择 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, background: '#181825', borderRadius: 8, padding: '8px 12px', border: '1px solid #313244' }}>
          <Text style={{ color: '#a6adc8', fontSize: 12, whiteSpace: 'nowrap' }}>从第</Text>
          <InputNumber
            size="small"
            min={1}
            max={lazyList.total || 1}
            value={rangeStart}
            onChange={v => setRangeStart(v ?? 1)}
            style={{ width: 80 }}
            disabled={running}
          />
          <Text style={{ color: '#a6adc8', fontSize: 12, whiteSpace: 'nowrap' }}>章 到 第</Text>
          <InputNumber
            size="small"
            min={1}
            max={lazyList.total || 1}
            value={rangeEnd}
            onChange={v => setRangeEnd(v ?? lazyList.total)}
            style={{ width: 80 }}
            disabled={running}
          />
          <Text style={{ color: '#a6adc8', fontSize: 12, whiteSpace: 'nowrap' }}>章</Text>
          <button
            onClick={handleSelectRange}
            disabled={running || rangeLoading}
            style={{
              padding: '2px 12px',
              background: rangeLoading ? '#45475a' : '#6366f1',
              border: 'none',
              borderRadius: 4,
              color: '#fff',
              cursor: (running || rangeLoading) ? 'not-allowed' : 'pointer',
              fontSize: 12,
              whiteSpace: 'nowrap',
            }}
          >
            {rangeLoading ? '加载中...' : '应用范围'}
          </button>
          <Text style={{ color: '#585b70', fontSize: 11 }}>共 {lazyList.total} 章，已选 {selectedIds.length} 章</Text>
        </div>
        <div
          ref={lazyList.listRef as React.RefObject<HTMLDivElement>}
          onScroll={lazyList.handleScroll}
          style={{ maxHeight: 160, overflowY: 'auto', background: '#181825', borderRadius: 8, padding: 12, border: '1px solid #313244' }}
        >
          {lazyList.hasLess && !lazyList.loading && (
            <div style={{ textAlign: 'center', padding: 4, color: '#585b70', fontSize: 11 }}>↑ 向上滚动加载更多</div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {lazyList.chapters.map((ch) => {
              const globalIndex = lazyList.offsetStart + lazyList.chapters.indexOf(ch) + 1;
              const cs = chapterStatuses.get(ch.id);
              return (
                <div key={ch.id} data-chapter-item style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Checkbox
                    checked={selectedIds.includes(ch.id)}
                    onChange={e => {
                      if (e.target.checked) {
                        setSelectedIds(prev => [...prev, ch.id]);
                      } else {
                        setSelectedIds(prev => prev.filter(id => id !== ch.id));
                      }
                    }}
                    disabled={running}
                  >
                    <span style={{ color: '#585b70', fontSize: 11, marginRight: 4 }}>#{globalIndex}</span>
                    <span style={{ color: '#cdd6f4' }}>{ch.title}</span>
                    {!ch.has_content && (
                      <Tag color="warning" style={{ marginLeft: 8, fontSize: 10 }}>无内容</Tag>
                    )}
                  </Checkbox>
                  <Tag color={chapterStatusColor[cs?.status || 'pending']}>
                    {chapterStatusLabel[cs?.status || 'pending']}
                  </Tag>
                </div>
              );
            })}
          </div>
          {lazyList.loading && (
            <div style={{ textAlign: 'center', padding: 8, color: '#585b70', fontSize: 11 }}>加载中...</div>
          )}
          {!lazyList.loading && lazyList.chapters.length === 0 && (
            <div style={{ textAlign: 'center', padding: 12, color: '#585b70' }}>暂无章节</div>
          )}
          {!lazyList.loading && !lazyList.hasMore && lazyList.chapters.length > 0 && (
            <div style={{ textAlign: 'center', padding: 4, color: '#585b70', fontSize: 11 }}>已加载全部</div>
          )}
        </div>
      </div>

      {/* ---- 日志面板 ---- */}
      <LogPanel logs={logs} maxHeight={200} onClear={() => setLogs([])} title="📊 挂机日志" />
    </Modal>
  );
}
