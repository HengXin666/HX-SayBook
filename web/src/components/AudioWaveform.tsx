import { PauseCircleOutlined, PlayCircleOutlined } from '@ant-design/icons';
import { Button, Space, Typography } from 'antd';
import { useCallback, useEffect, useRef, useState } from 'react';
import WaveSurfer from 'wavesurfer.js';

const { Text } = Typography;

interface AudioWaveformProps {
  /** 音频 URL */
  url: string;
  /** 波形高度，默认 48 */
  height?: number;
  /** 波形颜色，默认 #89b4fa */
  waveColor?: string;
  /** 播放进度颜色，默认 #f38ba8 */
  progressColor?: string;
  /** 是否显示迷你模式（更紧凑），默认 false */
  mini?: boolean;
  /** 外部控制：是否正在播放 */
  isPlaying?: boolean;
  /** 外部控制：播放状态变化回调 */
  onPlayStateChange?: (playing: boolean) => void;
}

/** 格式化秒数为 mm:ss */
function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function AudioWaveform({
  url,
  height = 48,
  waveColor = '#89b4fa',
  progressColor = '#f38ba8',
  mini = false,
  onPlayStateChange,
}: AudioWaveformProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [ready, setReady] = useState(false);

  // 初始化 WaveSurfer
  useEffect(() => {
    if (!containerRef.current) return;

    const ws = WaveSurfer.create({
      container: containerRef.current,
      height: height,
      waveColor: waveColor,
      progressColor: progressColor,
      cursorColor: '#cdd6f4',
      cursorWidth: 1,
      barWidth: mini ? 2 : 3,
      barGap: mini ? 1 : 2,
      barRadius: 2,
      normalize: true,
      backend: 'WebAudio',
    });

    ws.on('ready', () => {
      setDuration(ws.getDuration());
      setReady(true);
    });

    ws.on('audioprocess', () => {
      setCurrentTime(ws.getCurrentTime());
    });

    ws.on('seeking', () => {
      setCurrentTime(ws.getCurrentTime());
    });

    ws.on('play', () => {
      setPlaying(true);
      onPlayStateChange?.(true);
    });

    ws.on('pause', () => {
      setPlaying(false);
      onPlayStateChange?.(false);
    });

    ws.on('finish', () => {
      setPlaying(false);
      onPlayStateChange?.(false);
    });

    ws.load(url);
    wsRef.current = ws;

    return () => {
      ws.destroy();
      wsRef.current = null;
      setReady(false);
      setPlaying(false);
      setCurrentTime(0);
      setDuration(0);
    };
  }, [url, height, waveColor, progressColor, mini, onPlayStateChange]);

  const togglePlay = useCallback(() => {
    wsRef.current?.playPause();
  }, []);

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: mini ? 6 : 10,
      padding: mini ? '4px 0' : '8px 0',
      width: '100%',
    }}>
      {/* 播放/暂停按钮 */}
      <Button
        type="text"
        size={mini ? 'small' : 'middle'}
        icon={playing ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
        onClick={togglePlay}
        disabled={!ready}
        style={{
          color: playing ? '#f38ba8' : '#89b4fa',
          fontSize: mini ? 16 : 20,
          flexShrink: 0,
        }}
      />

      {/* 波形容器 */}
      <div
        ref={containerRef}
        style={{
          flex: 1,
          minWidth: 0,
          borderRadius: 6,
          overflow: 'hidden',
          cursor: ready ? 'pointer' : 'default',
          opacity: ready ? 1 : 0.4,
          transition: 'opacity 0.3s',
        }}
      />

      {/* 时间显示 */}
      <Space size={2} style={{ flexShrink: 0 }}>
        <Text style={{ color: '#cdd6f4', fontSize: mini ? 10 : 12, fontFamily: 'monospace' }}>
          {formatTime(currentTime)}
        </Text>
        <Text style={{ color: '#6c7086', fontSize: mini ? 10 : 12 }}>/</Text>
        <Text style={{ color: '#6c7086', fontSize: mini ? 10 : 12, fontFamily: 'monospace' }}>
          {formatTime(duration)}
        </Text>
      </Space>
    </div>
  );
}
