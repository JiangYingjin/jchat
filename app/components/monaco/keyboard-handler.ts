import type * as monaco from "monaco-editor";

/**
 * Monaco Editor 键盘事件处理器
 * 处理光标移动、删除等键盘事件，避免重复移动问题
 */
export class KeyboardHandler {
  private editorInstance: monaco.editor.IStandaloneCodeEditor | null = null;

  // 🎯 强化修复：全面阻止重复光标移动的补丁
  private lastMoveTime = 0;
  private lastMovePosition = { lineNumber: 0, column: 0 };
  private moveBlockCount = 0;

  // 键盘事件处理相关变量
  private lastKeyTime = 0;
  private lastKeyCode = 0;
  private lastKeyStage = "";
  private currentKeyEventId = 0;
  private processedKeyEvents = new Set<string>();

  // Shift 选区与内部状态
  private selectionAnchor: { lineNumber: number; column: number } | null = null;
  private isShiftSelecting = false;
  private isComposing = false;
  private isInternalUpdate = false;

  constructor(editorInstance: monaco.editor.IStandaloneCodeEditor) {
    this.editorInstance = editorInstance;
    // 设置键盘处理器引用，以便在拦截方法中访问
    (this.editorInstance as any).keyboardHandler = this;
    this.applyDuplicateCursorMovementFix();
  }

  /**
   * 检测当前焦点是否在Monaco Editor的搜索/替换框中
   * @returns 如果焦点在搜索/替换框中返回true，否则返回false
   */
  private isFindWidgetFocused(): boolean {
    if (!this.editorInstance) return false;

    try {
      // 获取当前活跃的元素
      const activeElement = document.activeElement;
      if (!activeElement) return false;

      // 检查是否在Monaco Editor的查找组件中
      const findWidget = activeElement.closest(".monaco-editor .find-widget");
      if (findWidget) {
        // 进一步检查是否在输入框中
        const inputElement = activeElement as HTMLInputElement;
        if (
          inputElement &&
          (inputElement.classList.contains("find-input") ||
            inputElement.classList.contains("replace-input") ||
            inputElement.getAttribute("aria-label")?.includes("Find") ||
            inputElement.getAttribute("aria-label")?.includes("Replace"))
        ) {
          return true;
        }
      }

      // 也可以通过检查Monaco Editor的内部状态
      const editorDomNode = this.editorInstance.getDomNode();
      if (editorDomNode) {
        const findWidgetInEditor = editorDomNode.querySelector(".find-widget");
        if (findWidgetInEditor && findWidgetInEditor.contains(activeElement)) {
          return true;
        }
      }

      return false;
    } catch (error) {
      // 如果检测过程中出现错误，默认返回false，使用自定义逻辑
      console.warn("[KeyboardHandler] 检测查找组件焦点状态失败:", error);
      return false;
    }
  }

  /**
   * 检测是否应该阻止光标移动
   * @param position 目标位置
   * @param methodName 调用的方法名
   * @returns 是否应该阻止移动
   */
  private shouldBlockMove(
    position: { lineNumber: number; column: number },
    methodName: string,
  ): boolean {
    if (!this.editorInstance) return false;

    // 内部更新时不阻断
    if (this.isInternalUpdate) return false;

    const currentTime = performance.now();
    const currentPosition = this.editorInstance.getPosition();

    if (!currentPosition) return false;

    // 检查是否是相同位置
    const isSamePosition =
      position.lineNumber === currentPosition.lineNumber &&
      position.column === currentPosition.column;

    // 检查时间间隔是否过短（防止重复移动）
    const timeDiff = currentTime - this.lastMoveTime;
    const isTooFrequent = timeDiff < 50; // 50ms内的移动认为是重复的

    // 检查是否是重复的移动操作
    const isDuplicateMove =
      position.lineNumber === this.lastMovePosition.lineNumber &&
      position.column === this.lastMovePosition.column &&
      timeDiff < 100;

    // 更新最后移动信息
    if (!isSamePosition) {
      this.lastMoveTime = currentTime;
      this.lastMovePosition = { ...position };
      this.moveBlockCount = 0;
    } else {
      this.moveBlockCount++;
    }

    // 阻止条件：
    // 1. 相同位置且频率过高
    // 2. 重复移动
    // 3. 移动阻塞计数过高
    const shouldBlock =
      (isSamePosition && isTooFrequent) ||
      isDuplicateMove ||
      this.moveBlockCount > 3;

    if (shouldBlock) {
      console.log(`🚫 阻止重复移动: ${methodName}`, {
        from: currentPosition,
        to: position,
        timeDiff,
        moveBlockCount: this.moveBlockCount,
      });
    }

    return shouldBlock;
  }

  /**
   * 应用重复光标移动修复补丁
   */
  private applyDuplicateCursorMovementFix() {
    if (!this.editorInstance) return;

    // 保存原始的 Monaco editor 实例引用
    const editorInstance = this.editorInstance;

    // 1. 拦截 setPosition 方法
    const originalSetPosition = (this.editorInstance as any).setPosition;
    if (originalSetPosition) {
      (this.editorInstance as any).setPosition = function (position: any) {
        if (
          (editorInstance as any).keyboardHandler?.shouldBlockMove(
            position,
            "setPosition",
          )
        ) {
          return; // 阻止重复移动
        }
        return originalSetPosition.call(editorInstance, position);
      };
    }

    // 2. 拦截 reveal 方法
    const originalRevealPosition = (this.editorInstance as any).revealPosition;
    if (originalRevealPosition) {
      (this.editorInstance as any).revealPosition = function (
        position: any,
        ...args: any[]
      ) {
        if (
          (editorInstance as any).keyboardHandler?.shouldBlockMove(
            position,
            "revealPosition",
          )
        ) {
          return; // 阻止重复移动
        }
        return originalRevealPosition.call(editorInstance, position, ...args);
      };
    }

    // 3. 拦截光标选择设置
    const originalSetSelection = (this.editorInstance as any).setSelection;
    if (originalSetSelection) {
      (this.editorInstance as any).setSelection = function (selection: any) {
        if (selection && selection.startLineNumber) {
          if (
            (editorInstance as any).keyboardHandler?.shouldBlockMove(
              {
                lineNumber: selection.startLineNumber,
                column: selection.startColumn,
              },
              "setSelection",
            )
          ) {
            return; // 阻止重复移动
          }
        }
        return originalSetSelection.call(editorInstance, selection);
      };
    }

    // 4. 拦截光标选择变化事件的触发
    const originalCursor = (this.editorInstance as any)._cursor;
    if (originalCursor) {
      // 尝试拦截光标控制器的核心方法
      if (originalCursor.setSelections) {
        const originalSetSelections = originalCursor.setSelections;
        originalCursor.setSelections = function (selections: any) {
          if (selections && selections[0]) {
            const selection = selections[0];
            if (
              (editorInstance as any).keyboardHandler?.shouldBlockMove(
                {
                  lineNumber: selection.startLineNumber,
                  column: selection.startColumn,
                },
                "cursor.setSelections",
              )
            ) {
              return; // 阻止重复移动
            }
          }
          return originalSetSelections.call(originalCursor, selections);
        };
      }
    }

    // 5. 拦截更深层的视图控制器
    const originalController = (this.editorInstance as any)._contributions
      ?.viewController;
    if (originalController && originalController.moveTo) {
      const originalMoveTo = originalController.moveTo;
      originalController.moveTo = function (position: any) {
        if (
          (editorInstance as any).keyboardHandler?.shouldBlockMove(
            position,
            "viewController.moveTo",
          )
        ) {
          return; // 阻止重复移动
        }
        return originalMoveTo.call(originalController, position);
      };
    }

    this.applyKeyboardEventFixes();
  }

  /**
   * 应用键盘事件修复
   */
  private applyKeyboardEventFixes() {
    if (!this.editorInstance) return;

    const keyboardEventFilter = (
      e: KeyboardEvent,
      stage: string = "unknown",
    ) => {
      const currentTime = performance.now();
      const timeDiff = currentTime - this.lastKeyTime;

      // 🎯 为每个原生事件分配唯一ID（基于时间戳和keyCode）
      const eventId = `${e.timeStamp}_${e.keyCode}_${e.key}`;

      // 🎯 检测所有可能导致重复移动的键
      const isNavigationOrDeleteKey = [
        "ArrowRight",
        "ArrowLeft",
        "ArrowUp",
        "ArrowDown",
        "Backspace",
        "Delete",
        "Home",
        "End",
        "PageUp",
        "PageDown",
      ].includes(e.key);

      if (isNavigationOrDeleteKey) {
        // 🚨 如果这是一个已经处理过的事件，直接阻止
        if (this.processedKeyEvents.has(eventId)) {
          e.preventDefault();
          e.stopImmediatePropagation();
          return false;
        }

        // 🚨 检测真正的重复按键（不同的事件，但是时间很近且keyCode相同）
        const isRealDuplicateKey =
          timeDiff < 100 && // 100ms内
          this.lastKeyCode === e.keyCode &&
          this.lastKeyStage !== "" && // 确保不是第一次
          !this.processedKeyEvents.has(eventId); // 且不是同一个事件

        if (isRealDuplicateKey) {
          e.preventDefault();
          e.stopImmediatePropagation();
          return false;
        }

        // 🚨 检测各种键的异常keyCode情况
        const expectedKeyCodes: { [key: string]: number } = {
          ArrowRight: 39,
          ArrowLeft: 37,
          ArrowUp: 38,
          ArrowDown: 40,
          Backspace: 8,
          Delete: 46,
          Home: 36,
          End: 35,
          PageUp: 33,
          PageDown: 34,
        };

        const expectedKeyCode = expectedKeyCodes[e.key];
        if (expectedKeyCode && e.keyCode !== expectedKeyCode) {
          e.preventDefault();
          e.stopImmediatePropagation();
          return false;
        }

        // ✅ 记录这个事件为已处理，防止在其他阶段重复处理
        this.processedKeyEvents.add(eventId);

        // 清理旧的事件记录（防止内存泄漏）
        if (this.processedKeyEvents.size > 20) {
          this.processedKeyEvents.clear();
        }
      }

      // 更新最后按键信息
      this.lastKeyTime = currentTime;
      this.lastKeyCode = e.keyCode;
      this.lastKeyStage = stage;
      return true;
    };

    this.applyCustomKeyHandling(keyboardEventFilter);
    this.applyMonacoInternalKeyCodeFix();
  }

  /**
   * 应用自定义键盘处理
   */
  private applyCustomKeyHandling(keyboardEventFilter: Function) {
    if (!this.editorInstance) return;

    // 🎯 简化为单点拦截策略 - 只在最早阶段进行重复检测
    const editorDomNode = this.editorInstance.getDomNode();
    if (editorDomNode) {
      // 组合输入标志
      editorDomNode.addEventListener("compositionstart", () => {
        this.isComposing = true;
      });
      editorDomNode.addEventListener("compositionend", () => {
        this.isComposing = false;
      });

      // 监听 keyup 以在 Shift 释放时退出选区模式
      editorDomNode.addEventListener(
        "keyup",
        (e: Event) => {
          const keyEvent = e as KeyboardEvent;
          if (keyEvent.key === "Shift") {
            this.isShiftSelecting = false;
            this.selectionAnchor = null;
          }
        },
        true,
      );

      // 🚨 选择性接管策略：只拦截问题键，保留上下键原生视觉行移动
      editorDomNode.addEventListener(
        "keydown",
        (e: Event) => {
          const keyEvent = e as KeyboardEvent;
          const currentTime = performance.now();
          const timeDiff = currentTime - this.lastKeyTime;

          // 🔍 允许查找快捷键通过（Ctrl+F）
          if (keyEvent.ctrlKey && keyEvent.key === "f") {
            return true; // 允许正常传播
          }

          // 🔍 允许查找相关快捷键通过
          if (
            keyEvent.ctrlKey &&
            (keyEvent.key === "h" || keyEvent.key === "g")
          ) {
            return true; // 允许正常传播
          }

          // 🎯 如果焦点在搜索/替换框中，使用Monaco内置逻辑，不进行自定义处理
          if (this.isFindWidgetFocused()) {
            // 对于搜索/替换框中的backspace和左右键，使用Monaco内置逻辑
            const isSearchBoxKey = [
              "ArrowRight",
              "ArrowLeft",
              "Backspace",
              "Delete",
            ].includes(keyEvent.key);

            if (isSearchBoxKey) {
              // 调试信息：确认在搜索框中使用Monaco内置逻辑
              console.log(
                "[KeyboardHandler] 检测到搜索框焦点，使用Monaco内置逻辑处理:",
                keyEvent.key,
              );
              return true; // 允许正常传播，使用Monaco内置逻辑
            }
          }

          // 🎯 只拦截确认有问题的键，让上下键正常传递给Monaco
          const isTargetKey = [
            "ArrowRight", // 有keyCode异常问题
            "ArrowLeft", // 有重复移动问题
            "Backspace", // 有重复删除问题
            "Delete", // 可能有重复删除问题
            "Home", // 简单的行首跳转
            "End", // 简单的行尾跳转
          ].includes(keyEvent.key);

          // 如果当前不按住 Shift，则退出 Shift 选区模式
          if (!keyEvent.shiftKey && this.isShiftSelecting) {
            this.isShiftSelecting = false;
            this.selectionAnchor = null;
          }

          // 处理 Shift + 左右键：扩展/收缩选区（逐字符，支持跨行）
          if (
            (keyEvent.key === "ArrowLeft" || keyEvent.key === "ArrowRight") &&
            keyEvent.shiftKey &&
            !this.isComposing
          ) {
            // 早期去重
            const isDuplicateEvent = timeDiff < 100 && timeDiff > 0;
            if (isDuplicateEvent) {
              e.preventDefault();
              e.stopImmediatePropagation();
              return false;
            }

            e.preventDefault();
            e.stopImmediatePropagation();

            if (!this.editorInstance) return false;
            const model = this.editorInstance.getModel();
            const currentPosition = this.editorInstance.getPosition();
            const selection = this.editorInstance.getSelection();
            if (!model || !currentPosition || !selection) return false;

            // 初始化锚点
            if (!this.isShiftSelecting || !this.selectionAnchor) {
              if (!selection.isEmpty()) {
                // 活动端为当前光标，锚点取另一端
                const start = {
                  lineNumber: selection.startLineNumber,
                  column: selection.startColumn,
                };
                const end = {
                  lineNumber: selection.endLineNumber,
                  column: selection.endColumn,
                };
                const pos = currentPosition;
                const isActiveAtEnd =
                  pos.lineNumber === end.lineNumber &&
                  pos.column === end.column;
                this.selectionAnchor = isActiveAtEnd ? start : end;
              } else {
                this.selectionAnchor = { ...currentPosition };
              }
              this.isShiftSelecting = true;
            }

            const maxLineNumber = model.getLineCount();
            const currentLineLength = model.getLineLength(
              currentPosition.lineNumber,
            );

            let newActive: { lineNumber: number; column: number } | null = null;

            if (keyEvent.key === "ArrowRight") {
              if (currentPosition.column <= currentLineLength) {
                newActive = {
                  lineNumber: currentPosition.lineNumber,
                  column: currentPosition.column + 1,
                };
              } else if (currentPosition.lineNumber < maxLineNumber) {
                newActive = {
                  lineNumber: currentPosition.lineNumber + 1,
                  column: 1,
                };
              }
            } else if (keyEvent.key === "ArrowLeft") {
              if (currentPosition.column > 1) {
                newActive = {
                  lineNumber: currentPosition.lineNumber,
                  column: currentPosition.column - 1,
                };
              } else if (currentPosition.lineNumber > 1) {
                const prevLineLength = model.getLineLength(
                  currentPosition.lineNumber - 1,
                );
                newActive = {
                  lineNumber: currentPosition.lineNumber - 1,
                  column: prevLineLength + 1,
                };
              }
            }

            if (newActive && this.selectionAnchor) {
              const anchor = this.selectionAnchor;
              // 内部更新，避免被 shouldBlockMove 拦截
              this.isInternalUpdate = true;
              try {
                const newSel = {
                  startLineNumber: anchor.lineNumber,
                  startColumn: anchor.column,
                  endLineNumber: newActive.lineNumber,
                  endColumn: newActive.column,
                } as monaco.Selection | monaco.ISelection;
                this.editorInstance.setSelection(newSel as any);
                this.editorInstance.revealPosition(newActive);
              } finally {
                // 微延时后清除内部标志，避免同步链路触发拦截
                setTimeout(() => {
                  this.isInternalUpdate = false;
                }, 0);
              }
            }

            this.lastKeyTime = currentTime;
            return false;
          }

          if (isTargetKey) {
            // 🚨 检测重复事件
            const isDuplicateEvent = timeDiff < 100 && timeDiff > 0;

            if (isDuplicateEvent) {
              e.preventDefault();
              e.stopImmediatePropagation();
              return false;
            }

            // 🎯 完全阻止原生事件，自行处理
            e.preventDefault();
            e.stopImmediatePropagation();

            // 🎯 自行实现光标移动逻辑（非 Shift 模式下）
            const currentPosition = this.editorInstance?.getPosition();
            if (!currentPosition || !this.editorInstance) {
              return false;
            }

            let newPosition: {
              lineNumber: number;
              column: number;
            } | null = null;
            const model = this.editorInstance.getModel();
            if (!model) {
              return false;
            }

            const maxLineNumber = model.getLineCount();
            const currentLineLength = model.getLineLength(
              currentPosition.lineNumber,
            );
            let handledKeyCount = (window as any)._monacoKeyCount || 0;
            (window as any)._monacoKeyCount = ++handledKeyCount;

            switch (keyEvent.key) {
              case "ArrowRight":
                if (currentPosition.column <= currentLineLength) {
                  newPosition = {
                    lineNumber: currentPosition.lineNumber,
                    column: currentPosition.column + 1,
                  };
                } else if (currentPosition.lineNumber < maxLineNumber) {
                  // 移动到下一行开头
                  newPosition = {
                    lineNumber: currentPosition.lineNumber + 1,
                    column: 1,
                  };
                }
                break;

              case "ArrowLeft":
                if (currentPosition.column > 1) {
                  newPosition = {
                    lineNumber: currentPosition.lineNumber,
                    column: currentPosition.column - 1,
                  };
                } else if (currentPosition.lineNumber > 1) {
                  // 移动到上一行末尾
                  const prevLineLength = model.getLineLength(
                    currentPosition.lineNumber - 1,
                  );
                  newPosition = {
                    lineNumber: currentPosition.lineNumber - 1,
                    column: prevLineLength + 1,
                  };
                }
                break;

              // 上下键已经被提前处理，不会到达这里

              case "Home":
                newPosition = {
                  lineNumber: currentPosition.lineNumber,
                  column: 1,
                };
                break;

              case "End":
                newPosition = {
                  lineNumber: currentPosition.lineNumber,
                  column: currentLineLength + 1,
                };
                break;

              case "Backspace":
                // 检查是否有选中文本
                const selection = this.editorInstance.getSelection();
                if (selection && !selection.isEmpty()) {
                  // 如果有选中文本，删除选中的内容
                  this.editorInstance.executeEdits("backspace", [
                    {
                      range: selection,
                      text: "",
                    },
                  ]);

                  // 光标移动到选择区域的开始位置
                  newPosition = {
                    lineNumber: selection.startLineNumber,
                    column: selection.startColumn,
                  };
                } else if (currentPosition.column > 1) {
                  // 删除当前位置前的字符
                  const range = {
                    startLineNumber: currentPosition.lineNumber,
                    startColumn: currentPosition.column - 1,
                    endLineNumber: currentPosition.lineNumber,
                    endColumn: currentPosition.column,
                  };

                  this.editorInstance.executeEdits("backspace", [
                    {
                      range: range,
                      text: "",
                    },
                  ]);

                  newPosition = {
                    lineNumber: currentPosition.lineNumber,
                    column: currentPosition.column - 1,
                  };
                } else if (currentPosition.lineNumber > 1) {
                  // 删除换行符，合并到上一行
                  const prevLineLength = model.getLineLength(
                    currentPosition.lineNumber - 1,
                  );
                  const range = {
                    startLineNumber: currentPosition.lineNumber - 1,
                    startColumn: prevLineLength + 1,
                    endLineNumber: currentPosition.lineNumber,
                    endColumn: 1,
                  };

                  this.editorInstance.executeEdits("backspace", [
                    {
                      range: range,
                      text: "",
                    },
                  ]);

                  newPosition = {
                    lineNumber: currentPosition.lineNumber - 1,
                    column: prevLineLength + 1,
                  };
                }
                break;

              case "Delete":
                // 检查是否有选中文本
                const deleteSelection = this.editorInstance.getSelection();
                if (deleteSelection && !deleteSelection.isEmpty()) {
                  // 如果有选中文本，删除选中的内容
                  this.editorInstance.executeEdits("delete", [
                    {
                      range: deleteSelection,
                      text: "",
                    },
                  ]);

                  // 光标移动到选择区域的开始位置
                  newPosition = {
                    lineNumber: deleteSelection.startLineNumber,
                    column: deleteSelection.startColumn,
                  };
                } else if (currentPosition.column <= currentLineLength) {
                  // 删除当前位置的字符
                  const range = {
                    startLineNumber: currentPosition.lineNumber,
                    startColumn: currentPosition.column,
                    endLineNumber: currentPosition.lineNumber,
                    endColumn: currentPosition.column + 1,
                  };

                  this.editorInstance.executeEdits("delete", [
                    {
                      range: range,
                      text: "",
                    },
                  ]);
                  // Delete操作后光标位置不变
                  newPosition = currentPosition;
                } else if (currentPosition.lineNumber < maxLineNumber) {
                  // 删除换行符，合并下一行
                  const range = {
                    startLineNumber: currentPosition.lineNumber,
                    startColumn: currentPosition.column,
                    endLineNumber: currentPosition.lineNumber + 1,
                    endColumn: 1,
                  };

                  this.editorInstance.executeEdits("delete", [
                    {
                      range: range,
                      text: "",
                    },
                  ]);
                  newPosition = currentPosition;
                }
                break;
            }

            // 🎯 设置新的光标位置
            if (
              newPosition &&
              (newPosition.lineNumber !== currentPosition.lineNumber ||
                newPosition.column !== currentPosition.column)
            ) {
              // 临时禁用我们的拦截器，避免递归
              const position = newPosition;
              setTimeout(() => {
                this.editorInstance?.setPosition(position);
                this.editorInstance?.revealPosition(position);
              }, 1);
            }

            this.lastKeyTime = currentTime;
            return false;
          }

          // 非目标键，允许正常传播
          return true;
        },
        true, // 捕获阶段，确保最早拦截
      );
    }
  }

  /**
   * 修复Monaco内部事件的异常keyCode
   */
  private applyMonacoInternalKeyCodeFix() {
    if (!this.editorInstance) return;

    // 保存原始的 Monaco editor 实例引用
    const editorInstance = this.editorInstance;

    // 🎯 修复Monaco内部事件的异常keyCode
    const originalOnKeyDown = (this.editorInstance as any).onKeyDown;
    if (originalOnKeyDown) {
      (this.editorInstance as any).onKeyDown = function (keyboardEvent: any) {
        const browserEvent = keyboardEvent.browserEvent;

        // 🚨 检测并修复异常的keyCode
        if (browserEvent) {
          const expectedKeyCodes: { [key: string]: number } = {
            ArrowRight: 39,
            ArrowLeft: 37,
            ArrowUp: 38,
            ArrowDown: 40,
            Backspace: 8,
            Delete: 46,
            Home: 36,
            End: 35,
            PageUp: 33,
            PageDown: 34,
          };

          const expectedKeyCode = expectedKeyCodes[browserEvent.key];

          // 如果Monaco接收到的keyCode与浏览器原生keyCode不一致，修复它
          if (expectedKeyCode && keyboardEvent.keyCode !== expectedKeyCode) {
            // 修正keyCode
            keyboardEvent.keyCode = expectedKeyCode;
          }

          // 🚨 如果是特定的异常组合，直接阻止
          const isProblematicEvent =
            (browserEvent.key === "ArrowRight" &&
              keyboardEvent.keyCode === 17) ||
            (browserEvent.key === "ArrowLeft" &&
              keyboardEvent.keyCode === 15) ||
            (browserEvent.key === "Backspace" && keyboardEvent.keyCode === 1);

          if (isProblematicEvent) {
            return; // 直接阻止这个事件
          }
        }

        // 继续处理修复后的事件
        return originalOnKeyDown.call(editorInstance, keyboardEvent);
      };
    }
  }

  /**
   * 延迟应用键盘事件修复补丁
   */
  applyFixesWithDelay() {
    // 延迟应用修复补丁，确保Monaco完全初始化
    setTimeout(() => {
      // 这里可以添加延迟应用的其他修复逻辑
    }, 500);
  }
}
