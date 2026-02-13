import { RobotOutlined, StopOutlined } from '@ant-design/icons';
import { Checkbox, InputNumber, Modal, Progress, Space, Tag, Typography, message } from 'antd';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { batchApi } from '../api';
import { useWebSocket } from '../hooks/useWebSocket';
import type { ChapterBrief, WSEvent } from '../types';
import LogPanel from './LogPanel';

const { Text } = Typography;

interface BatchLLMModalProps {
  open: boolean;
  onClose: () => void;
  projectId: number;
  chapters: ChapterBrief[];
  onComplete?: () => void;
  /** 任务运行状态变化时通知父组件（用于显示后台进度提示） */
  onRunningChange?: (running: boolean, progress: number, current: number, total: number) => void;
}

interface ChapterStatus {
  id: number;
  title: string;
  status: 'pending' | 'processing' | 'done' | 'error' | 'skipped' | 'cancelled';
}

export default function BatchLLMModal({ open, onClose, projectId, chapters, onComplete, onRunningChange }: BatchLLMModalProps) {
  const { subscribe } = useWebSocket();
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [running, setRunning] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [progress, setProgress] = useState(0);
  const [current, setCurrent] = useState(0);
  const [total, setTotal] = useState(0);
  const [chapterStatuses, setChapterStatuses] = useState<ChapterStatus[]>([]);
  const [concurrency, setConcurrency] = useState(1);
  // 标记是否已经初始化过（防止重复重置正在运行的任务状态）
  const hasInitRef = useRef(false);

  // 通知父组件运行状态变化
  useEffect(() => {
    onRunningChange?.(running, progress, current, total);
  }, [running, progress, current, total, onRunningChange]);

  // 弹窗打开时：如果没有正在运行的任务才重置状态，否则保留
  useEffect(() => {
    if (open && !running) {
      // 查询后端是否有正在运行的任务
      batchApi.llmStatus(projectId).then((res) => {
        if (res.code === 200 && res.data?.running) {
          // 后端有任务在运行，恢复运行状态
          setRunning(true);
          setCancelling(res.data.cancelled || false);
          if (logs.length === 0) {
            setLogs(['🔄 检测到后台有正在运行的批量LLM任务，已恢复监听...']);
          }
        } else if (!hasInitRef.current) {
          // 没有后台任务，且是首次打开，初始化选中章节
          const validIds = chapters.filter((c) => c.has_content).map((c) => c.id);
          setSelectedIds(validIds);
          setLogs([]);
          setProgress(0);
          setCurrent(0);
          setTotal(0);
          setCancelling(false);
          setChapterStatuses(chapters.map((c) => ({ id: c.id, title: c.title, status: 'pending' })));
          hasInitRef.current = true;
        }
      }).catch(() => {
        // 查询失败时，如果是首次打开就正常初始化
        if (!hasInitRef.current) {
          const validIds = chapters.filter((c) => c.has_content).map((c) => c.id);
          setSelectedIds(validIds);
          setLogs([]);
          setProgress(0);
          setCurrent(0);
          setTotal(0);
          setCancelling(false);
          setChapterStatuses(chapters.map((c) => ({ id: c.id, title: c.title, status: 'pending' })));
          hasInitRef.current = true;
        }
      });
    }
  }, [open, projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  // chapters 变化时更新章节状态列表（但保留已有状态）
  useEffect(() => {
    if (chapters.length > 0) {
      setChapterStatuses((prev) => {
        const prevMap = new Map(prev.map((cs) => [cs.id, cs]));
        return chapters.map((c) => prevMap.get(c.id) || { id: c.id, title: c.title, status: 'pending' as const });
      });
    }
  }, [chapters]);

  // WebSocket 事件监听：始终监听，不依赖 open（这样弹窗关闭也能收到状态更新）
  useEffect(() => {
    const unsubs = [
      subscribe('batch_llm_progress', (data: WSEvent) => {
        if (data.project_id !== projectId) return;
        const log = data.log as string;
        const status = data.status as string;
        const chapterId = data.chapter_id as number;

        setLogs((prev) => [...prev, log]);
        setProgress(data.progress as number);
        setCurrent(data.current as number);
        setTotal(data.total as number);

        setChapterStatuses((prev) =>
          prev.map((cs) => (cs.id === chapterId ? { ...cs, status: status as ChapterStatus['status'] } : cs)),
        );
      }),
      subscribe('batch_llm_log', (data: WSEvent) => {
        if (data.project_id !== projectId) return;
        setLogs((prev) => [...prev, data.log as string]);
      }),
      subscribe('batch_llm_complete', (data: WSEvent) => {
        if (data.project_id !== projectId) return;
        setLogs((prev) => [...prev, data.log as string]);
        setProgress(100);
        setRunning(false);
        setCancelling(false);
        // 重置初始化标记，下次打开弹窗会重新初始化
        hasInitRef.current = false;
        if (data.cancelled) {
          // 将所有仍为 pending 的章节标记为 cancelled
          setChapterStatuses((prev) =>
            prev.map((cs) => (cs.status === 'pending' ? { ...cs, status: 'cancelled' } : cs)),
          );
          message.warning('批量LLM解析已取消');
        } else {
          message.success('批量LLM解析全部完成！');
        }
        onComplete?.();
      }),
    ];

    return () => unsubs.forEach((fn) => fn());
  }, [subscribe, projectId, onComplete]);

  const handleStart = useCallback(async () => {
    if (selectedIds.length === 0) {
      message.warning('请先选择要解析的章节');
      return;
    }
    setRunning(true);
    setCancelling(false);
    setLogs([`🚀 开始批量LLM解析，共 ${selectedIds.length} 个章节，并发数: ${concurrency}`]);
    setProgress(0);
    setCurrent(0);
    setTotal(selectedIds.length);

    // 重置状态
    setChapterStatuses((prev) =>
      prev.map((cs) => ({ ...cs, status: selectedIds.includes(cs.id) ? 'pending' : cs.status })),
    );

    try {
      const res = await batchApi.llmParse({ project_id: projectId, chapter_ids: selectedIds, concurrency });
      if (res.code !== 200) {
        message.error(res.message || '启动失败');
        setRunning(false);
      }
    } catch {
      message.error('请求失败');
      setRunning(false);
    }
  }, [selectedIds, projectId, concurrency]);

  const handleCancel = useCallback(async () => {
    setCancelling(true);
    setLogs((prev) => [...prev, '⏳ 正在取消任务...']);
    try {
      const res = await batchApi.llmCancel(projectId);
      if (res.code === 200) {
        message.info('取消信号已发送，等待当前章节处理完毕后停止');
      } else {
        message.warning(res.message || '取消失败');
        setCancelling(false);
      }
    } catch {
      message.error('取消请求失败');
      setCancelling(false);
    }
  }, [projectId]);

  // 范围选择
  const [rangeStart, setRangeStart] = useState<number>(1);
  const [rangeEnd, setRangeEnd] = useState<number>(1);

  // 排序后的章节列表（按 order_index 或数组索引）
  const sortedChapters = useMemo(() => {
    return [...chapters].sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));
  }, [chapters]);

  // 初始化范围
  useEffect(() => {
    if (open && sortedChapters.length > 0) {
      setRangeStart(1);
      setRangeEnd(sortedChapters.length);
    }
  }, [open, sortedChapters.length]);

  const handleSelectAll = () => {
    const validIds = sortedChapters.filter((c) => c.has_content).map((c) => c.id);
    setSelectedIds(validIds);
  };

  const handleDeselectAll = () => {
    setSelectedIds([]);
  };

  // 按范围选择
  const handleSelectRange = () => {
    const start = Math.max(1, rangeStart);
    const end = Math.min(sortedChapters.length, rangeEnd);
    if (start > end) {
      message.warning('起始章节不能大于结束章节');
      return;
    }
    const rangeChapters = sortedChapters.slice(start - 1, end);
    const validIds = rangeChapters
      .filter((c) => c.has_content)
      .map((c) => c.id);
    setSelectedIds(validIds);
    message.success(`已选中第 ${start} ~ ${end} 章中有内容的 ${validIds.length} 个章节`);
  };

  const statusColor: Record<string, string> = {
    pending: 'default',
    processing: 'processing',
    done: 'success',
    error: 'error',
    skipped: 'warning',
    cancelled: 'warning',
  };

  const statusLabel: Record<string, string> = {
    pending: '待处理',
    processing: '解析中',
    done: '已完成',
    error: '失败',
    skipped: '已跳过',
    cancelled: '已取消',
  };

  return (
    <Modal
      title={
        <Space>
          <RobotOutlined />
          <span>批量 LLM 解析</span>
        </Space>
      }
      open={open}
      onCancel={onClose}
      closable={true}
      maskClosable={!running}
      width={800}
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
          <button
            onClick={handleStart}
            disabled={running || selectedIds.length === 0}
            style={{
              padding: '6px 16px',
              background: running ? '#45475a' : '#6366f1',
              border: 'none',
              borderRadius: 6,
              color: '#fff',
              cursor: running ? 'not-allowed' : 'pointer',
              fontWeight: 500,
            }}
          >
            {running ? `解析中 (${current}/${total})` : `开始解析 (${selectedIds.length} 章)`}
          </button>
        </Space>
      }
    >
      {/* 进度条 */}
      {running && (
        <div style={{ marginBottom: 16 }}>
          <Progress
            percent={progress}
            status={cancelling ? 'exception' : progress >= 100 ? 'success' : 'active'}
            format={() => `${current}/${total}`}
            strokeColor={cancelling ? '#ef4444' : '#6366f1'}
          />
        </div>
      )}

      {/* 并发数配置 */}
      <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8, background: '#181825', borderRadius: 8, padding: '8px 12px', border: '1px solid #313244' }}>
        <Text style={{ color: '#a6adc8', fontSize: 12, whiteSpace: 'nowrap' }}>并发数</Text>
        <InputNumber
          size="small"
          min={1}
          max={10}
          value={concurrency}
          onChange={(v) => setConcurrency(v ?? 1)}
          style={{ width: 80 }}
          disabled={running}
        />
        <Text style={{ color: '#585b70', fontSize: 11 }}>
          同时解析的章节数 (1~10)，并发数越大速度越快，但可能增加 LLM API 压力
        </Text>
      </div>

      {/* 章节选择 */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <Text strong style={{ color: '#cdd6f4' }}>选择章节范围</Text>
          <Space size={8}>
            <a onClick={handleSelectAll} style={{ fontSize: 12 }}>全选有内容的</a>
            <a onClick={handleDeselectAll} style={{ fontSize: 12 }}>取消全选</a>
          </Space>
        </div>
        {/* 范围快捷选择 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, background: '#181825', borderRadius: 8, padding: '8px 12px', border: '1px solid #313244' }}>
          <Text style={{ color: '#a6adc8', fontSize: 12, whiteSpace: 'nowrap' }}>从第</Text>
          <InputNumber
            size="small"
            min={1}
            max={sortedChapters.length}
            value={rangeStart}
            onChange={(v) => setRangeStart(v ?? 1)}
            style={{ width: 80 }}
            disabled={running}
          />
          <Text style={{ color: '#a6adc8', fontSize: 12, whiteSpace: 'nowrap' }}>章 到 第</Text>
          <InputNumber
            size="small"
            min={1}
            max={sortedChapters.length}
            value={rangeEnd}
            onChange={(v) => setRangeEnd(v ?? sortedChapters.length)}
            style={{ width: 80 }}
            disabled={running}
          />
          <Text style={{ color: '#a6adc8', fontSize: 12, whiteSpace: 'nowrap' }}>章</Text>
          <button
            onClick={handleSelectRange}
            disabled={running}
            style={{
              padding: '2px 12px',
              background: '#6366f1',
              border: 'none',
              borderRadius: 4,
              color: '#fff',
              cursor: running ? 'not-allowed' : 'pointer',
              fontSize: 12,
              whiteSpace: 'nowrap',
            }}
          >
            应用范围
          </button>
          <Text style={{ color: '#585b70', fontSize: 11 }}>共 {sortedChapters.length} 章，已选 {selectedIds.length} 章</Text>
        </div>
        <div style={{ maxHeight: 200, overflowY: 'auto', background: '#181825', borderRadius: 8, padding: 12, border: '1px solid #313244' }}>
          <Checkbox.Group
            value={selectedIds}
            onChange={(vals) => setSelectedIds(vals as number[])}
            style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
          >
            {sortedChapters.map((ch, idx) => (
              <div key={ch.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Checkbox value={ch.id} disabled={running}>
                  <span style={{ color: '#585b70', fontSize: 11, marginRight: 4 }}>#{idx + 1}</span>
                  <span style={{ color: '#cdd6f4' }}>{ch.title}</span>
                  {!ch.has_content && (
                    <Tag color="warning" style={{ marginLeft: 8, fontSize: 10 }}>无内容</Tag>
                  )}
                </Checkbox>
                <Tag color={statusColor[chapterStatuses.find((cs) => cs.id === ch.id)?.status || 'pending']}>
                  {statusLabel[chapterStatuses.find((cs) => cs.id === ch.id)?.status || 'pending']}
                </Tag>
              </div>
            ))}
          </Checkbox.Group>
        </div>
      </div>

      {/* 日志面板 */}
      <LogPanel logs={logs} maxHeight={250} onClear={() => setLogs([])} title="📊 LLM 解析日志" />
    </Modal>
  );
}
