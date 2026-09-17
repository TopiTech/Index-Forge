import { useEffect, useRef, useState, useImperativeHandle, forwardRef } from "react";
import { Tutorial3DScene, isWebGLAvailable } from "./Tutorial3DScene";

export interface Tutorial3DCanvasHandle {
  rotateCamera: (deltaTheta: number, deltaPhi: number) => void;
  zoomCamera: (deltaRadius: number) => void;
  resetCamera: () => void;
  toggleAutoRotate: (paused?: boolean) => boolean;
}

export interface Tutorial3DCanvasProps {
  currentStep: number;
  isReducedMotion: boolean;
  isAutoRotatePaused: boolean;
  onToggleAutoRotate?: (paused: boolean) => void;
  sceneDescription?: string;
}

export const Tutorial3DCanvas = forwardRef<Tutorial3DCanvasHandle, Tutorial3DCanvasProps>(
  function Tutorial3DCanvas(
    { currentStep, isReducedMotion, isAutoRotatePaused, onToggleAutoRotate, sceneDescription },
    ref,
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const sceneRef = useRef<Tutorial3DScene | null>(null);

    const [hasWebGL, setHasWebGL] = useState<boolean>(true);

    // Pointer drag tracking
    const isDraggingRef = useRef(false);
    const lastPointerPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

    // Expose camera control methods to parent component (for toolbar / keyboard hooks)
    useImperativeHandle(ref, () => ({
      rotateCamera: (deltaTheta: number, deltaPhi: number) => {
        sceneRef.current?.rotateCamera(deltaTheta, deltaPhi);
      },
      zoomCamera: (deltaRadius: number) => {
        sceneRef.current?.zoomCamera(deltaRadius);
      },
      resetCamera: () => {
        sceneRef.current?.resetCamera();
      },
      toggleAutoRotate: (paused?: boolean) => {
        const next = sceneRef.current?.toggleAutoRotate(paused) ?? false;
        onToggleAutoRotate?.(next);
        return next;
      },
    }));

    // Initialize Three.js Scene
    useEffect(() => {
      if (!isWebGLAvailable()) {
        setHasWebGL(false);
        return;
      }

      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return;

      const rect = container.getBoundingClientRect();
      const initialWidth = Math.max(300, rect.width);
      const initialHeight = Math.max(260, rect.height);

      let sceneInstance: Tutorial3DScene | null = null;
      try {
        sceneInstance = new Tutorial3DScene({
          canvas,
          width: initialWidth,
          height: initialHeight,
          initialStep: currentStep,
          isReducedMotion,
        });
        sceneInstance.isAutoRotatePaused = isAutoRotatePaused;
        sceneRef.current = sceneInstance;
      } catch (err) {
        console.warn("Failed to initialize Three.js WebGL scene:", err);
        setHasWebGL(false);
        return;
      }

      // Resize observer
      const resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const { width, height } = entry.contentRect;
          if (width > 0 && height > 0 && sceneRef.current) {
            sceneRef.current.resize(width, height);
          }
        }
      });
      resizeObserver.observe(container);

      return () => {
        resizeObserver.disconnect();
        if (sceneInstance) {
          sceneInstance.destroy();
          sceneRef.current = null;
        }
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Sync currentStep
    useEffect(() => {
      if (sceneRef.current) {
        sceneRef.current.setStep(currentStep);
      }
    }, [currentStep]);

    // Sync isReducedMotion
    useEffect(() => {
      if (sceneRef.current) {
        sceneRef.current.setReducedMotion(isReducedMotion);
      }
    }, [isReducedMotion]);

    // Sync isAutoRotatePaused
    useEffect(() => {
      if (sceneRef.current) {
        sceneRef.current.isAutoRotatePaused = isAutoRotatePaused;
      }
    }, [isAutoRotatePaused]);

    // Pointer events for orbit rotation
    const handlePointerDown = (e: React.PointerEvent) => {
      isDraggingRef.current = true;
      lastPointerPosRef.current = { x: e.clientX, y: e.clientY };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    };

    const handlePointerMove = (e: React.PointerEvent) => {
      if (!isDraggingRef.current || !sceneRef.current) return;
      const dx = e.clientX - lastPointerPosRef.current.x;
      const dy = e.clientY - lastPointerPosRef.current.y;
      lastPointerPosRef.current = { x: e.clientX, y: e.clientY };

      const rotateSpeed = 0.007;
      sceneRef.current.rotateCamera(-dx * rotateSpeed, dy * rotateSpeed);
    };

    const handlePointerUp = (e: React.PointerEvent) => {
      isDraggingRef.current = false;
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        // Safe ignore
      }
    };

    // Wheel event for zoom
    const handleWheel = (e: React.WheelEvent) => {
      e.preventDefault();
      if (!sceneRef.current) return;
      const zoomSpeed = 0.015;
      sceneRef.current.zoomCamera(e.deltaY * zoomSpeed);
    };

    // Keyboard support on the canvas element itself
    const handleKeyDown = (e: React.KeyboardEvent) => {
      if (!sceneRef.current) return;
      const step = 0.08;
      switch (e.key) {
        case "ArrowUp":
        case "w":
        case "W":
          e.preventDefault();
          sceneRef.current.rotateCamera(0, step);
          break;
        case "ArrowDown":
        case "s":
        case "S":
          e.preventDefault();
          sceneRef.current.rotateCamera(0, -step);
          break;
        case "ArrowLeft":
        case "a":
        case "A":
          e.preventDefault();
          sceneRef.current.rotateCamera(step, 0);
          break;
        case "ArrowRight":
        case "d":
        case "D":
          e.preventDefault();
          sceneRef.current.rotateCamera(-step, 0);
          break;
        case "+":
        case "=":
          e.preventDefault();
          sceneRef.current.zoomCamera(-1.2);
          break;
        case "-":
        case "_":
          e.preventDefault();
          sceneRef.current.zoomCamera(1.2);
          break;
        case "r":
        case "R":
          e.preventDefault();
          sceneRef.current.resetCamera();
          break;
        case " ": {
          e.preventDefault();
          const nextPaused = sceneRef.current.toggleAutoRotate();
          onToggleAutoRotate?.(nextPaused);
          break;
        }
      }
    };

    return (
      <div
        ref={containerRef}
        className="tutorial-3d-container"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onWheel={handleWheel}
        onKeyDown={handleKeyDown}
        tabIndex={0}
        role="region"
        aria-roledescription="3D インタラクティブビジュアライザー"
        aria-label={`IndexForge 3Dチュートリアルビジュアル。矢印キーで視点回転、+/-でズーム可能。${sceneDescription || ""}`}
      >
        {hasWebGL ? (
          <canvas
            ref={canvasRef}
            className="tutorial-3d-canvas"
            aria-hidden="true"
          />
        ) : (
          <div className="tutorial-3d-fallback" role="img" aria-label="3Dグラフィックス代替プレビュー">
            <div className="fallback-glow-orb" />
            <div className="fallback-grid" />
            <div className="fallback-content">
              <span className="badge badge-subtle mono tiny">2D FALLBACK MODE</span>
              <p className="muted tiny" style={{ marginTop: 8 }}>
                WebGLが利用できない環境のため、最適化された2Dモードで表示しています。
              </p>
            </div>
          </div>
        )}

        {/* Visual prompt for interactive canvas */}
        <div className="tutorial-3d-hint" aria-hidden="true">
          <span>ドラッグまたは矢印キーで3D視点操作</span>
        </div>
      </div>
    );
  },
);
