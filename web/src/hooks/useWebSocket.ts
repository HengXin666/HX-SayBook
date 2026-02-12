import { useCallback, useEffect, useRef, useState } from 'react';
import type { WSEvent } from '../types';

// 自动根据当前页面地址构建 WebSocket URL（支持外网访问）
const WS_URL = import.meta.env.VITE_WS_URL ||
  `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`;

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const listenersRef = useRef<Map<string, Set<(data: WSEvent) => void>>>(new Map());
  const [connected, setConnected] = useState(false);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      setConnected(true);
      console.log('[WS] 已连接');
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as WSEvent;
        if (data.type === 'pong') return;

        const eventName = data.event as string;
        if (eventName) {
          listenersRef.current.get(eventName)?.forEach((cb) => cb(data));
        }
        // 同时触发通配符监听
        listenersRef.current.get('*')?.forEach((cb) => cb(data));
      } catch {
        // 忽略解析错误
      }
    };

    ws.onclose = () => {
      setConnected(false);
      console.log('[WS] 断开连接，3秒后重连...');
      reconnectTimerRef.current = setTimeout(connect, 3000);
    };

    ws.onerror = () => {
      ws.close();
    };

    wsRef.current = ws;

    // 心跳
    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 30000);

    const origClose = ws.onclose;
    ws.onclose = (e) => {
      clearInterval(pingInterval);
      if (origClose) origClose.call(ws, e);
    };
  }, []);

  const subscribe = useCallback((event: string, callback: (data: WSEvent) => void) => {
    if (!listenersRef.current.has(event)) {
      listenersRef.current.set(event, new Set());
    }
    listenersRef.current.get(event)!.add(callback);

    return () => {
      listenersRef.current.get(event)?.delete(callback);
    };
  }, []);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  return { connected, subscribe };
}
