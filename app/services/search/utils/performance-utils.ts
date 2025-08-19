/**
 * 性能优化工具函数
 */

/**
 * 防抖函数
 */
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number,
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | null = null;

  return (...args: Parameters<T>) => {
    if (timeout) {
      clearTimeout(timeout);
    }
    timeout = setTimeout(() => func(...args), wait);
  };
}

/**
 * 节流函数
 */
export function throttle<T extends (...args: any[]) => any>(
  func: T,
  limit: number,
): (...args: Parameters<T>) => void {
  let inThrottle: boolean = false;

  return (...args: Parameters<T>) => {
    if (!inThrottle) {
      func(...args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}

/**
 * 缓存函数结果
 */
export function memoize<T extends (...args: any[]) => any>(
  fn: T,
  maxCacheSize: number = 100,
): T {
  const cache = new Map<string, ReturnType<T>>();

  return ((...args: Parameters<T>): ReturnType<T> => {
    const key = JSON.stringify(args);

    if (cache.has(key)) {
      return cache.get(key)!;
    }

    const result = fn(...args);

    // 限制缓存大小
    if (cache.size >= maxCacheSize) {
      const firstKey = cache.keys().next().value;
      if (firstKey !== undefined) {
        cache.delete(firstKey);
      }
    }

    cache.set(key, result);
    return result;
  }) as T;
}

/**
 * 异步任务取消控制器
 */
export class TaskController {
  private abortController: AbortController | null = null;

  /**
   * 开始新任务
   */
  start(): AbortSignal {
    this.cancel();
    this.abortController = new AbortController();
    return this.abortController.signal;
  }

  /**
   * 取消当前任务
   */
  cancel(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  /**
   * 检查是否被取消
   */
  get aborted(): boolean {
    return this.abortController?.signal.aborted ?? false;
  }

  /**
   * 清理资源
   */
  cleanup(): void {
    this.cancel();
  }
}

/**
 * 批处理执行器
 */
export class BatchProcessor<T> {
  private items: T[] = [];
  private timer: NodeJS.Timeout | null = null;
  private processor: (items: T[]) => void;
  private batchSize: number;
  private delay: number;

  constructor(
    processor: (items: T[]) => void,
    batchSize: number = 10,
    delay: number = 100,
  ) {
    this.processor = processor;
    this.batchSize = batchSize;
    this.delay = delay;
  }

  /**
   * 添加项目到批处理队列
   */
  add(item: T): void {
    this.items.push(item);

    // 达到批处理大小，立即执行
    if (this.items.length >= this.batchSize) {
      this.flush();
      return;
    }

    // 否则等待延迟
    if (this.timer) {
      clearTimeout(this.timer);
    }

    this.timer = setTimeout(() => this.flush(), this.delay);
  }

  /**
   * 强制执行批处理
   */
  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    if (this.items.length > 0) {
      const items = this.items.splice(0);
      this.processor(items);
    }
  }

  /**
   * 清理资源
   */
  cleanup(): void {
    this.flush();
  }
}
