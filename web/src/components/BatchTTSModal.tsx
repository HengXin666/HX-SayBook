import { SoundOutlined } from '@ant-design/icons';
import { Checkbox, InputNumber, Modal, Progress, Slider, Space, Tag, Typography, message } from 'antd';
import { useCallback, useEffect, useRef, useState } from 'react';
import { batchApi, chapterApi } from '../api';
import { useChapterLazyList } from '../hooks/useChapterLazyList';
import { useWebSocket } from '../hooks/useWebSocket';
import type { WSEvent } from '../types';
import LogPanel from './LogPanel';

const { Text } = Typography;

interface BatchTTSModalProps {
  open: boolean;
  onClose: () => void;
  projectId: number;
  onComplete?: () => void;
}

interface ChapterStatus {
  id: number;
  title: string;
  status: 'pending' | 'processing' | 'done' | 'error';
  lineCount?: number;
  doneCount?: number;
}

export default function BatchTTSModal({ open, onClose, projectId, onComplete }: BatchTTSModalProps) {
  const { subscribe } = useWebSocket();
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [overallProgress, setOverallProgress] = useState(0);
  const [overallDone, setOverallDone] = useState(0);
  const [overallTotal, setOverallTotal] = useState(0);
  const [speed, setSpeed] = useState(1.0);
  const [chapterStatuses, setChapterStatuses] = useState<Map<number, ChapterStatus>>(new Map());
  const [currentChapterIdx, setCurrentChapterIdx] = useState(0);
  const [totalChapters, setTotalChapters] = useState(0);

  // 使用懒加载 Hook
  const lazyList = useChapterLazyList({ projectId });

  // 初始化
  useEffect(() => {
    if (open) {
      lazyList.init();
      setSelectedIds([]);
      setLogs([]);
      setOverallProgress(0);
      setOverallDone(0);
      setOverallTotal(0);
      setSpeed(1.0);
      setCurrentChapterIdx(0);
      setTotalChapters(0);
      setChapterStatuses(new Map());
    }
  }, [open, projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  // 懒加载列表加载后，自动选中新加载的章节（首次时全选）
  const firstLoadRef = useRef(true);
  useEffect(() => {
    if (open && lazyList.chapters.length > 0 && !running) {
      const newIds = lazyList.chapters.map((c) => c.id);
      setSelectedIds(prev => {
        const combined = new Set([...prev, ...newIds]);
        return Array.from(combined);
      });
      if (firstLoadRef.current) {
        firstLoadRef.current = false;
      }
    }
  }, [lazyList.chapters]); // eslint-disable-line react-hooks/exhaustive-deps

  // 重置 firstLoadRef
  useEffect(() => {
    if (open) {
      firstLoadRef.current = true;
    }
  }, [open]);

  // 监听 WebSocket 事件
  useEffect(() => {
    if (!open) return;

    const unsubs = [
      subscribe('batch_tts_start', (data: WSEvent) => {
        if (data.project_id !== projectId) return;
        setLogs((prev) => [...prev, data.log as string]);
        setOverallTotal(data.total_lines as number);
        setTotalChapters(data.total_chapters as number);
      }),
      subscribe('batch_tts_chapter_start', (data: WSEvent) => {
        if (data.project_id !== projectId) return;
        const chapterId = data.chapter_id as number;
        setLogs((prev) => [...prev, data.log as string]);
        setCurrentChapterIdx(data.chapter_index as number);
        setChapterStatuses((prev) => {
          const next = new Map(prev);
          const existing = next.get(chapterId);
          next.set(chapterId, {
            id: chapterId,
            title: existing?.title || `章节 ${chapterId}`,
            status: 'processing',
            lineCount: data.line_count as number,
            doneCount: 0,
          });
          return next;
        });
      }),
      subscribe('batch_tts_line_progress', (data: WSEvent) => {
        if (data.project_id !== projectId) return;
        setLogs((prev) => [...prev, data.log as string]);
        setOverallProgress(data.progress as number);
        setOverallDone(data.overall_done as number);
        setOverallTotal(data.overall_total as number);

        const chapterId = data.chapter_id as number;
        const lineStatus = data.status as string;
        if (lineStatus === 'done' || lineStatus === 'failed') {
          setChapterStatuses((prev) => {
            const next = new Map(prev);
            const existing = next.get(chapterId);
            if (existing) {
              next.set(chapterId, { ...existing, doneCount: (existing.doneCount || 0) + 1 });
            }
            return next;
          });
        }
      }),
      subscribe('batch_tts_chapter_done', (data: WSEvent) => {
        if (data.project_id !== projectId) return;
        const chapterId = data.chapter_id as number;
        setLogs((prev) => [...prev, data.log as string]);
        setChapterStatuses((prev) => {
          const next = new Map(prev);
          const existing = next.get(chapterId);
          if (existing) {
            next.set(chapterId, { ...existing, status: 'done' });
          }
          return next;
        });
      }),
      subscribe('batch_tts_log', (data: WSEvent) => {
        if (data.project_id !== projectId) return;
        setLogs((prev) => [...prev, data.log as string]);
      }),
      subscribe('batch_tts_complete', (data: WSEvent) => {
        if (data.project_id !== projectId) return;
        setLogs((prev) => [...prev, data.log as string]);
        setOverallProgress(100);
        setRunning(false);
        message.success('批量TTS配音全部完成！');
        onComplete?.();
      }),
    ];

    return () => unsubs.forEach((fn) => fn());
  }, [open, subscribe, projectId, onComplete]);

  const handleStart = useCallback(async () => {
    if (selectedIds.length === 0) {
      message.warning('请先选择要配音的章节');
      return;
    }
    setRunning(true);
    setLogs([`🚀 开始批量TTS配音，共 ${selectedIds.length} 个章节，语速 ${speed}x`]);
    setOverallProgress(0);
    setOverallDone(0);
    setOverallTotal(0);

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
      const res = await batchApi.ttsGenerate({ project_id: projectId, chapter_ids: selectedIds, speed });
      if (res.code !== 200) {
        message.error(res.message || '启动失败');
        setRunning(false);
      }
    } catch {
      message.error('请求失败');
      setRunning(false);
    }
  }, [selectedIds, projectId, speed]);

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
    const ids = lazyList.chapters.map((c) => c.id);
    setSelectedIds(prev => {
      const combined = new Set([...prev, ...ids]);
      return Array.from(combined);
    });
    message.info('已选中当前可见章节。如需全部选中，请使用范围选择。');
  };

  const handleDeselectAll = () => setSelectedIds([]);

  // 按范围选择：通过后端接口直接获取范围内所有章节 ID
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
      // 通过后端接口获取范围内所有章节 ID
      const res = await chapterApi.getIdsByRange(projectId, { start, end });
      if (res.data && res.data.length > 0) {
        setSelectedIds(res.data);
        message.success(`已选中第 ${start} ~ ${end} 章，共 ${res.data.length} 个章节`);
      } else {
        setSelectedIds([]);
        message.warning(`第 ${start} ~ ${end} 章中没有章节`);
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
  };

  const statusLabel: Record<string, string> = {
    pending: '待配音',
    processing: '配音中',
    done: '已完成',
    error: '失败',
  };

  return (
    <Modal
      title={
        <Space>
          <SoundOutlined />
          <span>批量 TTS 配音</span>
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
            {running ? `配音中 (${overallDone}/${overallTotal})` : `开始配音 (${selectedIds.length} 章)`}
          </button>
        </Space>
      }
      destroyOnClose
    >
      {/* 总进度条 */}
      {running && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <Text style={{ color: '#a6adc8', fontSize: 12 }}>
              总进度: 章节 {currentChapterIdx}/{totalChapters}，台词 {overallDone}/{overallTotal}
            </Text>
            <Text style={{ color: '#a6adc8', fontSize: 12 }}>{overallProgress}%</Text>
          </div>
          <Progress
            percent={overallProgress}
            status={overallProgress >= 100 ? 'success' : 'active'}
            strokeColor="#6366f1"
            showInfo={false}
          />
        </div>
      )}

      {/* 语速调节 */}
      <div style={{ marginBottom: 16, background: '#181825', borderRadius: 8, padding: 12, border: '1px solid #313244' }}>
        <Text strong style={{ color: '#cdd6f4', display: 'block', marginBottom: 8 }}>
          🎚️ 全局语速: {speed}x
        </Text>
        <Slider
          min={0.5}
          max={2.0}
          step={0.1}
          value={speed}
          onChange={setSpeed}
          disabled={running}
          marks={{ 0.5: '0.5x', 1.0: '1.0x', 1.5: '1.5x', 2.0: '2.0x' }}
        />
      </div>

      {/* 章节选择 */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <Text strong style={{ color: '#cdd6f4' }}>选择章节</Text>
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
          style={{ maxHeight: 180, overflowY: 'auto', background: '#181825', borderRadius: 8, padding: 12, border: '1px solid #313244' }}
        >
          {lazyList.hasLess && !lazyList.loading && (
            <div style={{ textAlign: 'center', padding: 4, color: '#585b70', fontSize: 11 }}>↑ 向上滚动加载更多</div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {lazyList.chapters.map((ch, idx) => {
              const globalIndex = lazyList.offsetStart + idx + 1;
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
                  </Checkbox>
                  <Space size={4}>
                    {cs?.lineCount != null && cs.status === 'processing' && (
                      <Tag color="blue" style={{ fontSize: 10 }}>{cs.doneCount || 0}/{cs.lineCount}</Tag>
                    )}
                    <Tag color={statusColor[cs?.status || 'pending']}>
                      {statusLabel[cs?.status || 'pending']}
                    </Tag>
                  </Space>
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
      <LogPanel logs={logs} maxHeight={200} onClear={() => setLogs([])} title="📊 TTS 配音日志" />
    </Modal>
  );
}
