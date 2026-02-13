import { RobotOutlined } from '@ant-design/icons';
import { Checkbox, InputNumber, Modal, Progress, Space, Tag, Typography, message } from 'antd';
import { useCallback, useEffect, useMemo, useState } from 'react';
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
}

interface ChapterStatus {
  id: number;
  title: string;
  status: 'pending' | 'processing' | 'done' | 'error' | 'skipped';
}

export default function BatchLLMModal({ open, onClose, projectId, chapters, onComplete }: BatchLLMModalProps) {
  const { subscribe } = useWebSocket();
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [progress, setProgress] = useState(0);
  const [current, setCurrent] = useState(0);
  const [total, setTotal] = useState(0);
  const [chapterStatuses, setChapterStatuses] = useState<ChapterStatus[]>([]);

  // 初始化选中所有有内容的章节
  useEffect(() => {
    if (open) {
      const validIds = chapters.filter((c) => c.has_content).map((c) => c.id);
      setSelectedIds(validIds);
      setLogs([]);
      setProgress(0);
      setCurrent(0);
      setTotal(0);
      setChapterStatuses(chapters.map((c) => ({ id: c.id, title: c.title, status: 'pending' })));
    }
  }, [open, chapters]);

  // 监听 WebSocket 事件
  useEffect(() => {
    if (!open) return;

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
        message.success('批量LLM解析全部完成！');
        onComplete?.();
      }),
    ];

    return () => unsubs.forEach((fn) => fn());
  }, [open, subscribe, projectId, onComplete]);

  const handleStart = useCallback(async () => {
    if (selectedIds.length === 0) {
      message.warning('请先选择要解析的章节');
      return;
    }
    setRunning(true);
    setLogs([`🚀 开始批量LLM解析，共 ${selectedIds.length} 个章节`]);
    setProgress(0);
    setCurrent(0);
    setTotal(selectedIds.length);

    // 重置状态
    setChapterStatuses((prev) =>
      prev.map((cs) => ({ ...cs, status: selectedIds.includes(cs.id) ? 'pending' : cs.status })),
    );

    try {
      const res = await batchApi.llmParse({ project_id: projectId, chapter_ids: selectedIds });
      if (res.code !== 200) {
        message.error(res.message || '启动失败');
        setRunning(false);
      }
    } catch {
      message.error('请求失败');
      setRunning(false);
    }
  }, [selectedIds, projectId]);

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
  };

  const statusLabel: Record<string, string> = {
    pending: '待处理',
    processing: '解析中',
    done: '已完成',
    error: '失败',
    skipped: '已跳过',
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
      onCancel={running ? undefined : onClose}
      closable={!running}
      maskClosable={!running}
      width={800}
      footer={
        <Space>
          {!running && (
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
              关闭
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
      destroyOnClose
    >
      {/* 进度条 */}
      {running && (
        <div style={{ marginBottom: 16 }}>
          <Progress
            percent={progress}
            status={progress >= 100 ? 'success' : 'active'}
            format={() => `${current}/${total}`}
            strokeColor="#6366f1"
          />
        </div>
      )}

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
