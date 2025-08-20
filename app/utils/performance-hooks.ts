import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 智能防抖Hook - 根据文本长度动态调整防抖延迟
 * 用于系统提示词编辑等大文本场景的性能优化
 */
export function useSmartDebounce<T>(
  value: T,
  getTextLength?: (value: T) => number,
): [T, boolean] {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);
  const [isDebouncing, setIsDebouncing] = useState(false);
  const timerRef = useRef<NodeJS.Timeout>();

  useEffect(() => {
    // 计算当前文本长度
    const textLength = getTextLength
      ? getTextLength(value)
      : typeof value === "string"
        ? value.length
        : 0;

    // 根据文本长度智能调整防抖延迟
    let delay = 300; // 基础延迟 300ms

    if (textLength > 500000) {
      // 超过50万字符：1200ms
      delay = 1200;
    } else if (textLength > 100000) {
      // 超过10万字符：800ms
      delay = 800;
    } else if (textLength > 50000) {
      // 超过5万字符：500ms
      delay = 500;
    } else if (textLength > 10000) {
      // 超过1万字符：400ms
      delay = 400;
    }

    setIsDebouncing(true);

    // 清除之前的定时器
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    // 设置新的防抖定时器
    timerRef.current = setTimeout(() => {
      setDebouncedValue(value);
      setIsDebouncing(false);
    }, delay);

    // 清理函数
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [value, getTextLength]);

  // 组件卸载时清理
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  return [debouncedValue, isDebouncing];
}

/**
 * 非受控文本域Hook - 避免React受控组件的性能问题
 * 直接操作DOM，只在必要时同步状态
 */
export function useUncontrolledTextarea(
  initialValue: string,
  onChange: (value: string) => void,
) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lastSyncedValueRef = useRef(initialValue);
  const [currentValue, setCurrentValue] = useState(initialValue);

  // 智能防抖处理onChange回调
  const [debouncedValue, isDebouncing] = useSmartDebounce(
    currentValue,
    (value: string) => value.length,
  );

  // 当防抖值变化时，调用onChange回调
  useEffect(() => {
    if (debouncedValue !== lastSyncedValueRef.current) {
      lastSyncedValueRef.current = debouncedValue;
      onChange(debouncedValue);
    }
  }, [debouncedValue, onChange]);

  // 处理输入事件
  const handleInput = useCallback((e: React.FormEvent<HTMLTextAreaElement>) => {
    const newValue = e.currentTarget.value;
    setCurrentValue(newValue);
  }, []);

  // 手动设置值（用于外部更新）
  const setValue = useCallback((newValue: string) => {
    if (textareaRef.current) {
      textareaRef.current.value = newValue;
      setCurrentValue(newValue);
      lastSyncedValueRef.current = newValue;
    }
  }, []);

  // 获取当前DOM中的实际值
  const getValue = useCallback(() => {
    return textareaRef.current?.value || currentValue;
  }, [currentValue]);

  // 初始化时设置DOM值
  useEffect(() => {
    if (textareaRef.current && textareaRef.current.value !== initialValue) {
      textareaRef.current.value = initialValue;
    }
  }, [initialValue]);

  return {
    textareaRef,
    handleInput,
    setValue,
    getValue,
    isDebouncing,
    currentValue,
  };
}

/**
 * 高频操作节流Hook
 * 用于滚动、选择等高频事件的性能优化
 */
export function useThrottle<T extends (...args: any[]) => any>(
  func: T,
  limit: number = 100,
): (...args: Parameters<T>) => void {
  const inThrottle = useRef(false);

  return useCallback(
    (...args: Parameters<T>) => {
      if (!inThrottle.current) {
        func(...args);
        inThrottle.current = true;
        setTimeout(() => {
          inThrottle.current = false;
        }, limit);
      }
    },
    [func, limit],
  );
}

/**
 * 大文本内存优化Hook
 * 监控文本长度，在超过阈值时提供警告和优化建议
 */
export function useTextMemoryMonitor(text: string | undefined) {
  const [memoryStatus, setMemoryStatus] = useState<{
    level: "normal" | "warning" | "critical";
    message?: string;
    suggestions?: string[];
  }>({ level: "normal" });

  useEffect(() => {
    // 🛡️ 安全检查：确保text存在且为字符串
    if (!text || typeof text !== "string") {
      setMemoryStatus({ level: "normal" });
      return;
    }

    const length = text.length;

    if (length > 5000000) {
      // 500万字符
      setMemoryStatus({
        level: "critical",
        message: "文本长度过大，可能影响浏览器性能",
        suggestions: ["考虑分段编辑", "使用外部编辑器", "启用自动保存"],
      });
    } else if (length > 1000000) {
      // 100万字符
      setMemoryStatus({
        level: "warning",
        message: "文本长度较大，建议优化",
        suggestions: ["定期保存进度", "避免频繁复制粘贴"],
      });
    } else {
      setMemoryStatus({ level: "normal" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text?.length]); // 🛡️ 使用可选链操作符

  return memoryStatus;
}
