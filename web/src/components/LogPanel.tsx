import { ClearOutlined, VerticalAlignBottomOutlined } from '@ant-design/icons';
import { Button, Space, Tag } from 'antd';
import { useEffect, useRef, useState } from 'react';

interface LogPanelProps {
  logs: string[];
  maxHeight?: number;
  height?: number; // 精确高度（优先于 maxHeight）
  onClear?: () => void;
  title?: string;
}

/** 判断日志类型 */
function getLogType(log: string): 'error' | 'success' | 'warning' | 'info' {
  if (log.includes('❌') || log.includes('失败') || log.includes('error')) return 'error';
  if (log.includes('✅') || log.includes('完成') || log.includes('🎉')) return 'success';
  if (log.includes('⚠️') || log.includes('跳过') || log.includes('warning')) return 'warning';
  return 'info';
}

const typeColorMap: Record<string, string> = {
  error: '#f38ba8',
  success: '#a6e3a1',
  warning: '#f9e2af',
  info: '#a6adc8',
};

export default function LogPanel({ logs, maxHeight = 300, height, onClear, title = '📊 实时日志' }: LogPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  const handleScroll = () => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    // 如果用户滚动到距离底部 50px 以内，重新开启自动滚动
    setAutoScroll(scrollHeight - scrollTop - clientHeight < 50);
  };

  return (
    <div style={{ background: '#181825', borderRadius: 8, border: '1px solid #313244', display: 'flex', flexDirection: 'column', height: height != null ? '100%' : undefined }}>
      {/* 标题栏 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', borderBottom: '1px solid #313244' }}>
        <Space>
          <span style={{ color: '#cdd6f4', fontWeight: 500, fontSize: 13 }}>{title}</span>
          <Tag color="blue">{logs.length} 条</Tag>
        </Space>
        <Space size={4}>
          <Button
            type="text"
            size="small"
            icon={<VerticalAlignBottomOutlined />}
            onClick={() => {
              setAutoScroll(true);
              if (containerRef.current) {
                containerRef.current.scrollTop = containerRef.current.scrollHeight;
              }
            }}
            style={{ color: autoScroll ? '#6366f1' : '#6c7086' }}
            title="滚动到底部"
          />
          {onClear && (
            <Button
              type="text"
              size="small"
              icon={<ClearOutlined />}
              onClick={onClear}
              style={{ color: '#6c7086' }}
              title="清除日志"
            />
          )}
        </Space>
      </div>

      {/* 日志内容 */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        style={{
          ...(height != null ? { flex: 1, minHeight: 0 } : { maxHeight }),
          overflowY: 'auto',
          padding: '8px 12px',
          fontFamily: "'Fira Code', 'Cascadia Code', monospace",
          fontSize: 12,
          lineHeight: 1.8,
        }}
      >
        {logs.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 20, color: '#6c7086' }}>暂无日志</div>
        ) : (
          logs.map((log, idx) => {
            const type = getLogType(log);
            return (
              <div key={idx} style={{ color: typeColorMap[type], whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                {log}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
