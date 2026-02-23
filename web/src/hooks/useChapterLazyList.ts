import { useCallback, useRef, useState } from 'react';
import { chapterApi } from '../api';
import type { ChapterBrief } from '../types';

const PAGE_SIZE = 50;

export interface UseChapterLazyListOptions {
  projectId: number;
}

export interface UseChapterLazyListReturn {
  /** 当前已加载的章节列表 */
  chapters: ChapterBrief[];
  /** 章节总数 */
  total: number;
  /** 是否正在加载 */
  loading: boolean;
  /** 向下是否还有更多 */
  hasMore: boolean;
  /** 向上是否还有更多 */
  hasLess: boolean;
  /** 当前窗口起始偏移 */
  offsetStart: number;
  /** 初始化加载（弹窗打开时调用），从第1页开始 */
  init: () => Promise<void>;
  /** 加载指定页（支持 replace / append / prepend） */
  loadPage: (page: number, direction?: 'replace' | 'append' | 'prepend') => Promise<void>;
  /** 跳转到指定章节序号位置（1-based），清空列表后加载该位置所在页 */
  jumpToIndex: (index: number) => Promise<void>;
  /** 滚动事件处理器，绑定到列表容器的 onScroll */
  handleScroll: (e: React.UIEvent<HTMLDivElement>) => void;
  /** 列表容器 ref */
  listRef: React.RefObject<HTMLDivElement>;
  /** 重置状态 */
  reset: () => void;
}

export function useChapterLazyList({ projectId }: UseChapterLazyListOptions): UseChapterLazyListReturn {
  const [chapters, setChapters] = useState<ChapterBrief[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [hasLess, setHasLess] = useState(false);
  const [offsetStart, setOffsetStart] = useState(0);

  const listRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);
  const scrollLockRef = useRef(false);
  const chaptersRef = useRef<ChapterBrief[]>([]);
  const offsetStartRef = useRef(0);

  // 保持 ref 与 state 同步
  const updateChapters = useCallback((updater: (prev: ChapterBrief[]) => ChapterBrief[]) => {
    setChapters(prev => {
      const next = updater(prev);
      chaptersRef.current = next;
      return next;
    });
  }, []);

  const updateOffsetStart = useCallback((val: number) => {
    setOffsetStart(val);
    offsetStartRef.current = val;
  }, []);

  const loadPage = useCallback(async (
    page: number,
    direction: 'replace' | 'append' | 'prepend' = 'replace',
  ) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    try {
      const res = await chapterApi.getPage(projectId, { page, page_size: PAGE_SIZE });
      if (res.data) {
        const { items, total: t, page: currentPage } = res.data;
        const offset = (currentPage - 1) * PAGE_SIZE;
        setTotal(t);

        if (direction === 'append') {
          updateChapters(prev => {
            const existingIds = new Set(prev.map(c => c.id));
            const newItems = items.filter(c => !existingIds.has(c.id));
            return [...prev, ...newItems];
          });
          setHasMore(offset + items.length < t);
        } else if (direction === 'prepend') {
          const listEl = listRef.current;
          const prevScrollHeight = listEl?.scrollHeight ?? 0;
          updateChapters(prev => {
            const existingIds = new Set(prev.map(c => c.id));
            const newItems = items.filter(c => !existingIds.has(c.id));
            return [...newItems, ...prev];
          });
          updateOffsetStart(offset);
          setHasLess(offset > 0);
          // DOM 更新后补偿滚动位置
          requestAnimationFrame(() => {
            if (listEl) {
              listEl.scrollTop += listEl.scrollHeight - prevScrollHeight;
            }
          });
        } else {
          // replace
          updateChapters(() => items);
          updateOffsetStart(offset);
          setHasLess(offset > 0);
          setHasMore(offset + items.length < t);
        }
      } else {
        if (direction === 'replace') {
          updateChapters(() => []);
          updateOffsetStart(0);
        }
        setHasMore(false);
        setHasLess(false);
      }
    } finally {
      setLoading(false);
      loadingRef.current = false;
    }
  }, [projectId, updateChapters, updateOffsetStart]);

  const init = useCallback(async () => {
    scrollLockRef.current = true;
    await loadPage(1, 'replace');
    setTimeout(() => { scrollLockRef.current = false; }, 300);
  }, [loadPage]);

  const jumpToIndex = useCallback(async (index: number) => {
    // index 是 1-based 的章节序号
    scrollLockRef.current = true;
    const page = Math.ceil(index / PAGE_SIZE);
    await loadPage(page, 'replace');
    // 滚动到目标项
    setTimeout(() => {
      if (listRef.current) {
        // 计算在当前页内的偏移
        const localIndex = (index - 1) % PAGE_SIZE;
        const items = listRef.current.querySelectorAll('[data-chapter-item]');
        if (items[localIndex]) {
          items[localIndex].scrollIntoView({ block: 'start', behavior: 'auto' });
        }
      }
      setTimeout(() => { scrollLockRef.current = false; }, 300);
    }, 50);
  }, [loadPage]);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    if (scrollLockRef.current || loadingRef.current) return;
    const target = e.currentTarget;
    // 向下滚动到底部附近
    if (target.scrollHeight - target.scrollTop - target.clientHeight < 100) {
      const currentChapters = chaptersRef.current;
      const currentOffset = offsetStartRef.current;
      const nextPage = Math.floor((currentOffset + currentChapters.length) / PAGE_SIZE) + 1;
      loadPage(nextPage, 'append');
    }
    // 向上滚动到顶部附近
    if (target.scrollTop < 100) {
      const currentOffset = offsetStartRef.current;
      const prevPage = Math.floor(currentOffset / PAGE_SIZE);
      if (prevPage >= 1) {
        loadPage(prevPage, 'prepend');
      }
    }
  }, [loadPage]);

  const reset = useCallback(() => {
    updateChapters(() => []);
    setTotal(0);
    setLoading(false);
    setHasMore(true);
    setHasLess(false);
    updateOffsetStart(0);
  }, [updateChapters, updateOffsetStart]);

  return {
    chapters,
    total,
    loading,
    hasMore,
    hasLess,
    offsetStart,
    init,
    loadPage,
    jumpToIndex,
    handleScroll,
    listRef,
    reset,
  };
}
