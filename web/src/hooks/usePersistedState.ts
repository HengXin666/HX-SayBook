import { useCallback, useState } from 'react';

/**
 * 带 localStorage 持久化的 useState hook
 * @param key localStorage 的 key
 * @param defaultValue 默认值（当 localStorage 中没有值时使用）
 */
export function usePersistedState<T>(key: string, defaultValue: T): [T, (value: T | ((prev: T) => T)) => void] {
  const [state, setState] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(key);
      if (stored !== null) {
        return JSON.parse(stored) as T;
      }
    } catch { /* ignore */ }
    return defaultValue;
  });

  const setPersistedState = useCallback((value: T | ((prev: T) => T)) => {
    setState((prev) => {
      const next = typeof value === 'function' ? (value as (prev: T) => T)(prev) : value;
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch { /* ignore */ }
      return next;
    });
  }, [key]);

  return [state, setPersistedState];
}

/**
 * 批量持久化多个配置项
 * @param prefix localStorage key 前缀（如 'saybook_batchllm_123'）
 * @param defaults 默认值对象
 */
export function usePersistedConfig<T extends Record<string, unknown>>(
  prefix: string,
  defaults: T
): [T, <K extends keyof T>(key: K, value: T[K]) => void, () => void] {
  const [config, setConfig] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(prefix);
      if (stored !== null) {
        const parsed = JSON.parse(stored);
        // 合并默认值（防止新增字段丢失）
        return { ...defaults, ...parsed };
      }
    } catch { /* ignore */ }
    return defaults;
  });

  const updateField = useCallback(<K extends keyof T>(key: K, value: T[K]) => {
    setConfig((prev) => {
      const next = { ...prev, [key]: value };
      try {
        localStorage.setItem(prefix, JSON.stringify(next));
      } catch { /* ignore */ }
      return next;
    });
  }, [prefix]);

  const resetConfig = useCallback(() => {
    setConfig(defaults);
    try {
      localStorage.removeItem(prefix);
    } catch { /* ignore */ }
  }, [prefix, defaults]);

  return [config, updateField, resetConfig];
}
