import * as monaco from "monaco-editor/esm/vs/editor/editor.api";

/**
 * 自动滚动系统
 * 处理 Monaco Editor 的中键点击自动滚动功能
 */
export class AutoScrollSystem {
  private autoScrollActiveRef = { current: false };
  private anchorRef = { current: { x: 0, y: 0 } };
  private velocityRef = { current: { vy: 0 } };
  private targetVelocityRef = { current: { vy: 0 } };
  private lastTsRef = { current: 0 };
  private residualRef = { current: 0 };
  private rafRef = { current: 0 };
  private overlayRef = { current: null as HTMLDivElement | null };
  private editorInstance: monaco.editor.IStandaloneCodeEditor | null = null;

  constructor(private monacoStyles: any) {}

  /**
   * 初始化自动滚动系统
   */
  initialize(editorInstance: monaco.editor.IStandaloneCodeEditor) {
    this.editorInstance = editorInstance;
    this.setupMiddleClickHandler();
  }

  /**
   * 创建自动滚动覆盖层
   */
  private createOverlay = (x: number, y: number) => {
    const overlay = document.createElement("div");
    overlay.className = this.monacoStyles["auto-scroll-overlay"];
    overlay.style.left = `${x}px`;
    overlay.style.top = `${y}px`;

    const crossV = document.createElement("div");
    crossV.className = this.monacoStyles["auto-scroll-cross-v"];

    const crossH = document.createElement("div");
    crossH.className = this.monacoStyles["auto-scroll-cross-h"];

    const center = document.createElement("div");
    center.className = this.monacoStyles["auto-scroll-center-dot"];

    overlay.appendChild(crossV);
    overlay.appendChild(crossH);
    overlay.appendChild(center);
    document.body.appendChild(overlay);
    this.overlayRef.current = overlay;
  };

  /**
   * 销毁覆盖层
   */
  private destroyOverlay = () => {
    if (this.overlayRef.current && this.overlayRef.current.parentElement) {
      this.overlayRef.current.parentElement.removeChild(
        this.overlayRef.current,
      );
    }
    this.overlayRef.current = null;
  };

  /**
   * 停止自动滚动
   */
  private stopAutoScroll = () => {
    this.autoScrollActiveRef.current = false;
    this.velocityRef.current.vy = 0;
    this.targetVelocityRef.current.vy = 0;
    this.residualRef.current = 0;
    this.lastTsRef.current = 0;
    if (this.rafRef.current) {
      cancelAnimationFrame(this.rafRef.current);
      this.rafRef.current = 0;
    }
    this.destroyOverlay();
  };

  /**
   * 动画循环
   */
  private tick = () => {
    if (!this.autoScrollActiveRef.current || !this.editorInstance) return;
    const now = performance.now();
    const dtMs =
      this.lastTsRef.current === 0 ? 16.67 : now - this.lastTsRef.current;
    this.lastTsRef.current = now;

    // 指数平滑，减少抖动（稍强的平滑以改善慢速）
    const smoothingCoeff = 0.06;
    const alpha = 1 - Math.exp(-smoothingCoeff * dtMs);
    this.velocityRef.current.vy =
      this.velocityRef.current.vy +
      (this.targetVelocityRef.current.vy - this.velocityRef.current.vy) * alpha;

    try {
      const dtNorm = Math.min(2.5, Math.max(0.25, dtMs / 16.67));
      let delta = this.velocityRef.current.vy * dtNorm;
      if (!Number.isFinite(delta)) delta = 0;

      // 超低速时启用极小阈值，消除细微抖动与漂移
      if (Math.abs(delta) < 0.25) delta = 0;

      if (delta !== 0) {
        const currentTop = this.editorInstance.getScrollTop();
        this.editorInstance.setScrollTop(currentTop + delta);
      }
    } catch {}

    this.rafRef.current = requestAnimationFrame(this.tick);
  };

  /**
   * 鼠标移动处理
   */
  private onMouseMove = (e: MouseEvent) => {
    if (!this.autoScrollActiveRef.current) return;
    const dy = e.clientY - this.anchorRef.current.y;
    if (!Number.isFinite(dy)) return;
    // 软死区 + 平滑曲线，避免临界点跳变
    const deadzone = 6; // px
    const range = 240; // 达到最大速度所需的位移
    const maxSpeed = 48; // 60fps 基准的每帧像素

    const mag = Math.max(0, Math.abs(dy) - deadzone);
    let t = Math.min(1, mag / range); // 0..1
    // smoothstep easing（C1 连续）
    t = t * t * (3 - 2 * t);
    let speed = maxSpeed * t;

    // 极小速度阈值，避免慢速时细微跳动
    if (speed < 0.2) speed = 0;
    this.targetVelocityRef.current.vy = dy >= 0 ? speed : -speed;
  };

  /**
   * 鼠标按下处理
   */
  private onAnyMouseDown = () => {
    if (this.autoScrollActiveRef.current) this.stopAutoScroll();
  };

  /**
   * 键盘按下处理
   */
  private onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape" && this.autoScrollActiveRef.current) {
      this.stopAutoScroll();
    }
  };

  /**
   * 开始自动滚动
   */
  private startAutoScroll = (e: MouseEvent) => {
    this.autoScrollActiveRef.current = true;
    this.anchorRef.current = { x: e.clientX, y: e.clientY };
    this.createOverlay(e.clientX, e.clientY);
    try {
      this.editorInstance?.focus();
    } catch {}
    // 监听全局事件用于控制滚动与退出
    window.addEventListener("mousemove", this.onMouseMove, true);
    window.addEventListener("mousedown", this.onAnyMouseDown, true);
    window.addEventListener("auxclick", this.onAnyMouseDown, true);
    window.addEventListener("keydown", this.onKeyDown, true);
    window.addEventListener("blur", this.stopAutoScroll, true);
    // 启动动画循环
    this.rafRef.current = requestAnimationFrame(this.tick);
  };

  /**
   * 中键点击拦截器
   */
  private middleClickInterceptor = (e: MouseEvent) => {
    if (e && e.button === 1) {
      e.preventDefault();
      if (typeof (e as any).stopImmediatePropagation === "function") {
        (e as any).stopImmediatePropagation();
      } else {
        e.stopPropagation();
      }
      if (this.autoScrollActiveRef.current) {
        this.stopAutoScroll();
      } else {
        this.startAutoScroll(e);
      }
    }
  };

  /**
   * 设置中键点击处理器
   */
  private setupMiddleClickHandler() {
    const editorDomNode = this.editorInstance?.getDomNode();
    if (editorDomNode) {
      editorDomNode.addEventListener(
        "mousedown",
        this.middleClickInterceptor,
        true,
      );
      editorDomNode.addEventListener(
        "auxclick",
        this.middleClickInterceptor,
        true,
      );
    }
  }

  /**
   * 销毁自动滚动系统
   */
  dispose() {
    this.stopAutoScroll();

    // 移除事件监听器
    const editorDomNode = this.editorInstance?.getDomNode();
    if (editorDomNode) {
      editorDomNode.removeEventListener(
        "mousedown",
        this.middleClickInterceptor,
        true,
      );
      editorDomNode.removeEventListener(
        "auxclick",
        this.middleClickInterceptor,
        true,
      );
    }

    // 移除全局事件监听器
    window.removeEventListener("mousemove", this.onMouseMove, true);
    window.removeEventListener("mousedown", this.onAnyMouseDown, true);
    window.removeEventListener("auxclick", this.onAnyMouseDown, true);
    window.removeEventListener("keydown", this.onKeyDown, true);
    window.removeEventListener("blur", this.stopAutoScroll, true);
  }
}
