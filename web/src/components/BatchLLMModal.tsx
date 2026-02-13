import { RobotOutlined, StopOutlined } from '@ant-design/icons';
import { Checkbox, InputNumber, Modal, Progress, Space, Tag, Typography, message } from 'antd';
import { useCallback, useEffect, useRef, useState } from 'react';
import { batchApi, chapterApi } from '../api';
import { useChapterLazyList } from '../hooks/useChapterLazyList';
import { useWebSocket } from '../hooks/useWebSocket';
import type { WSEvent } from '../types';
import LogPanel from './LogPanel';

const { Text } = Typography;

interface BatchLLMModalProps {
  open: boolean;
  onClose: () => void;
  projectId: number;
  onComplete?: () => void;
  /** 任务运行状态变化时通知父组件（用于显示后台进度提示） */
  onRunningChange?: (running: boolean, progress: number, current: number, total: number) => void;
}

interface ChapterStatus {
  id: number;
  title: string;
  status: 'pending' | 'processing' | 'done' | 'error' | 'skipped' | 'cancelled';
}

export default function BatchLLMModal({ open, onClose, projectId, onComplete, onRunningChange }: BatchLLMModalProps) {
  const { subscribe } = useWebSocket();
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [running, setRunning] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [progress, setProgress] = useState(0);
  const [current, setCurrent] = useState(0);
  const [total, setTotal] = useState(0);
  const [chapterStatuses, setChapterStatuses] = useState<Map<number, ChapterStatus>>(new Map());
  const [concurrency, setConcurrency] = useState(1);
  // 标记是否已经初始化过（防止重复重置正在运行的任务状态）
  const hasInitRef = useRef(false);

  // 使用懒加载 Hook
  const lazyList = useChapterLazyList({ projectId });

  // 通知父组件运行状态变化
  useEffect(() => {
    onRunningChange?.(running, progress, current, total);
  }, [running, progress, current, total, onRunningChange]);

  // 弹窗打开时：初始化懒加载列表 + 检查后台任务状态
  useEffect(() => {
    if (open) {
      // 初始化懒加载列表
      lazyList.init();

      if (!running) {
        // 查询后端是否有正在运行的任务
        batchApi.llmStatus(projectId).then((res) => {
          if (res.code === 200 && res.data?.running) {
            setRunning(true);
            setCancelling(res.data.cancelled || false);
            if (logs.length === 0) {
              setLogs(['🔄 检测到后台有正在运行的批量LLM任务，已恢复监听...']);
            }
          } else if (!hasInitRef.current) {
            setLogs([]);
            setProgress(0);
            setCurrent(0);
            setTotal(0);
            setCancelling(false);
            setChapterStatuses(new Map());
            setSelectedIds([]);
            hasInitRef.current = true;
          }
        }).catch(() => {
          if (!hasInitRef.current) {
            setLogs([]);
            setProgress(0);
            setCurrent(0);
            setTotal(0);
            setCancelling(false);
            setChapterStatuses(new Map());
            setSelectedIds([]);
            hasInitRef.current = true;
          }
        });
      }
    }
  }, [open, projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  // 懒加载列表加载后，自动选中有内容的章节（仅首次初始化时）
  useEffect(() => {
    if (open && lazyList.chapters.length > 0 && hasInitRef.current && selectedIds.length === 0 && !running) {
      const validIds = lazyList.chapters.filter((c) => c.has_content).map((c) => c.id);
      setSelectedIds(prev => {
        const combined = new Set([...prev, ...validIds]);
        return Array.from(combined);
      });
    }
  }, [lazyList.chapters]); // eslint-disable-line react-hooks/exhaustive-deps

  // WebSocket 事件监听：始终监听，不依赖 open
  useEffect(() => {
    const unsubs = [
      subscribe('batch_llm_progress', (data: WSEvent) => {
        if (data.project_id !== projectId) return;
        const log = data.log as string;
        const status = data.status as string;
        const chapterId = data.chapter_id as number;
        const chapterTitle = data.chapter_title as string | undefined;

        setLogs((prev) => [...prev, log]);
        setProgress(data.progress as number);
        setCurrent(data.current as number);
        setTotal(data.total as number);

        setChapterStatuses((prev) => {
          const next = new Map(prev);
          const existing = next.get(chapterId);
          next.set(chapterId, {
            id: chapterId,
            title: existing?.title || chapterTitle || `章节 ${chapterId}`,
            status: status as ChapterStatus['status'],
          });
          return next;
        });
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
        hasInitRef.current = false;
        if (data.cancelled) {
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

    // 重置已选章节的状态
    setChapterStatuses((prev) => {
      const next = new Map(prev);
      selectedIds.forEach((id) => {
        const existing = next.get(id);
        if (existing) {
          next.set(id, { ...existing, status: 'pending' });
        }
      });
      return next;
    });

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

  // 初始化范围
  useEffect(() => {
    if (open && lazyList.total > 0) {
      setRangeStart(1);
      setRangeEnd(lazyList.total);
    }
  }, [open, lazyList.total]);

  const handleSelectAll = () => {
    // 全选：选中当前已加载列表中有内容的章节
    const validIds = lazyList.chapters.filter((c) => c.has_content).map((c) => c.id);
    setSelectedIds(prev => {
      const combined = new Set([...prev, ...validIds]);
      return Array.from(combined);
    });
    message.info('已选中当前可见的有内容章节。如需全部选中，请使用范围选择。');
  };

  const handleDeselectAll = () => {
    setSelectedIds([]);
  };

  // 按范围选择：通过后端接口直接获取范围内所有有内容的章节 ID
  const [rangeLoading, setRangeLoading] = useState(false);
  const handleSelectRange = useCallback(async () => {
    const start = Math.max(1, rangeStart);
    const end = Math.min(lazyList.total, rangeEnd);
    if (start > end) {
      message.warning('起始章节不能大于结束章节');
      return;
    }

    setRangeLoading(true);
    try {
      // 通过后端接口获取范围内所有有内容的章节 ID
      const res = await chapterApi.getIdsByRange(projectId, { start, end, has_content_only: true });
      if (res.data && res.data.length > 0) {
        setSelectedIds(res.data);
        message.success(`已选中第 ${start} ~ ${end} 章中 ${res.data.length} 个有内容的章节`);
      } else {
        setSelectedIds([]);
        message.warning(`第 ${start} ~ ${end} 章中没有有内容的章节`);
      }
      // 清空列表并跳转到 L 位置
      lazyList.reset();
      await lazyList.jumpToIndex(start);
    } catch {
      message.error('获取范围章节失败');
    } finally {
      setRangeLoading(false);
    }
  }, [rangeStart, rangeEnd, lazyList, projectId]);

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
            <a onClick={handleSelectAll} style={{ fontSize: 12 }}>选中可见的</a>
            <a onClick={handleDeselectAll} style={{ fontSize: 12 }}>取消全选</a>
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
            onChange={(v) => setRangeStart(v ?? 1)}
            style={{ width: 80 }}
            disabled={running}
          />
          <Text style={{ color: '#a6adc8', fontSize: 12, whiteSpace: 'nowrap' }}>章 到 第</Text>
          <InputNumber
            size="small"
            min={1}
            max={lazyList.total || 1}
            value={rangeEnd}
            onChange={(v) => setRangeEnd(v ?? lazyList.total)}
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
          style={{ maxHeight: 200, overflowY: 'auto', background: '#181825', borderRadius: 8, padding: 12, border: '1px solid #313244' }}
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
                    onChange={(e) => {
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
                  <Tag color={statusColor[cs?.status || 'pending']}>
                    {statusLabel[cs?.status || 'pending']}
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

      {/* 日志面板 */}
      <LogPanel logs={logs} maxHeight={250} onClear={() => setLogs([])} title="📊 LLM 解析日志" />
    </Modal>
  );
}
