// Adapted from React Bits "DotGrid" (reactbits.dev, MIT): a canvas of solid dots that light up
// near the pointer and scatter with inertia when swept or clicked. Changes for an always-open
// finance app: the draw loop sleeps when nothing moves (no idle 60 fps), pauses in hidden tabs,
// renders a static grid under prefers-reduced-motion, uses pointer events (touch + pen), and a
// click only ripples the dots when it lands on empty background — never on a button or link.
import { useCallback, useEffect, useMemo, useRef, type CSSProperties } from "react";
import { gsap } from "gsap";
import { InertiaPlugin } from "gsap/InertiaPlugin";

gsap.registerPlugin(InertiaPlugin);

interface Dot {
  cx: number;
  cy: number;
  xOffset: number;
  yOffset: number;
  busy: boolean;
}

export interface DotGridProps {
  dotSize?: number;
  gap?: number;
  baseColor?: string;
  activeColor?: string;
  proximity?: number;
  speedTrigger?: number;
  shockRadius?: number;
  shockStrength?: number;
  maxSpeed?: number;
  resistance?: number;
  returnDuration?: number;
  className?: string;
  style?: CSSProperties;
}

function hexToRgb(hex: string) {
  const m = hex.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
  if (!m) return { r: 0, g: 0, b: 0 };
  return { r: parseInt(m[1] ?? "0", 16), g: parseInt(m[2] ?? "0", 16), b: parseInt(m[3] ?? "0", 16) };
}

const INTERACTIVE =
  "a, button, input, select, textarea, label, summary, [contenteditable='true'], [data-no-ripple], " +
  "[role='button'], [role='link'], [role='tab'], [role='menuitem'], [role='option'], [role='checkbox'], [role='switch'], [role='dialog']";
const IDLE_MS = 1800;

export default function DotGrid({
  dotSize = 2,
  gap = 26,
  baseColor = "#222226",
  activeColor = "#f0b23e",
  proximity = 140,
  speedTrigger = 100,
  shockRadius = 220,
  shockStrength = 3,
  maxSpeed = 5000,
  resistance = 750,
  returnDuration = 1.5,
  className = "",
  style,
}: DotGridProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dotsRef = useRef<Dot[]>([]);
  const pointer = useRef({ x: -9999, y: -9999, lastTime: 0, lastX: 0, lastY: 0 });
  const loop = useRef({ raf: 0, running: false, lastActivity: 0, busyCount: 0 });

  const baseRgb = useMemo(() => hexToRgb(baseColor), [baseColor]);
  const activeRgb = useMemo(() => hexToRgb(activeColor), [activeColor]);
  const reduceMotion = useMemo(() => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches, []);
  const circlePath = useMemo(() => {
    if (typeof window === "undefined" || !window.Path2D) return null;
    const p = new Path2D();
    p.arc(0, 0, dotSize / 2, 0, Math.PI * 2);
    return p;
  }, [dotSize]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !circlePath) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const { x: px, y: py } = pointer.current;
    const proxSq = proximity * proximity;
    for (const dot of dotsRef.current) {
      const dx = dot.cx - px;
      const dy = dot.cy - py;
      const dsq = dx * dx + dy * dy;
      let fill = baseColor;
      if (dsq <= proxSq) {
        const t = 1 - Math.sqrt(dsq) / proximity;
        fill = `rgb(${Math.round(baseRgb.r + (activeRgb.r - baseRgb.r) * t)},${Math.round(baseRgb.g + (activeRgb.g - baseRgb.g) * t)},${Math.round(baseRgb.b + (activeRgb.b - baseRgb.b) * t)})`;
      }
      ctx.save();
      ctx.translate(dot.cx + dot.xOffset, dot.cy + dot.yOffset);
      ctx.fillStyle = fill;
      ctx.fill(circlePath);
      ctx.restore();
    }
  }, [baseColor, baseRgb, activeRgb, proximity, circlePath]);

  // Run the frame loop only while something is moving; it stops itself once idle.
  const wake = useCallback(() => {
    const l = loop.current;
    l.lastActivity = performance.now();
    if (l.running || reduceMotion || document.hidden) return;
    l.running = true;
    const tick = () => {
      draw();
      const idle = performance.now() - l.lastActivity > IDLE_MS && l.busyCount === 0;
      if (idle || document.hidden) {
        l.running = false;
        return;
      }
      l.raf = requestAnimationFrame(tick);
    };
    l.raf = requestAnimationFrame(tick);
  }, [draw, reduceMotion]);

  const buildGrid = useCallback(() => {
    const wrap = wrapperRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const { width, height } = wrap.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    canvas.getContext("2d")?.scale(dpr, dpr);

    const cell = dotSize + gap;
    const cols = Math.floor((width + gap) / cell);
    const rows = Math.floor((height + gap) / cell);
    const startX = (width - (cell * cols - gap)) / 2 + dotSize / 2;
    const startY = (height - (cell * rows - gap)) / 2 + dotSize / 2;
    const dots: Dot[] = [];
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) dots.push({ cx: startX + x * cell, cy: startY + y * cell, xOffset: 0, yOffset: 0, busy: false });
    }
    dotsRef.current = dots;
    draw();
  }, [dotSize, gap, draw]);

  const push = useCallback(
    (dot: Dot, pushX: number, pushY: number) => {
      dot.busy = true;
      loop.current.busyCount += 1;
      gsap.killTweensOf(dot);
      gsap.to(dot, {
        inertia: { xOffset: pushX, yOffset: pushY, resistance },
        onComplete: () => {
          gsap.to(dot, {
            xOffset: 0,
            yOffset: 0,
            duration: returnDuration,
            ease: "elastic.out(1,0.75)",
            onComplete: () => {
              dot.busy = false;
              loop.current.busyCount = Math.max(0, loop.current.busyCount - 1);
            },
          });
        },
      });
    },
    [resistance, returnDuration],
  );

  useEffect(() => {
    buildGrid();
    const ro = new ResizeObserver(buildGrid);
    if (wrapperRef.current) ro.observe(wrapperRef.current);
    return () => ro.disconnect();
  }, [buildGrid]);

  useEffect(() => {
    if (reduceMotion) return;
    const l = loop.current;

    const onMove = (e: PointerEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const now = performance.now();
      const pr = pointer.current;
      const dt = pr.lastTime ? Math.max(now - pr.lastTime, 1) : 16;
      let vx = ((e.clientX - pr.lastX) / dt) * 1000;
      let vy = ((e.clientY - pr.lastY) / dt) * 1000;
      let speed = Math.hypot(vx, vy);
      if (speed > maxSpeed) {
        vx *= maxSpeed / speed;
        vy *= maxSpeed / speed;
        speed = maxSpeed;
      }
      pr.lastTime = now;
      pr.lastX = e.clientX;
      pr.lastY = e.clientY;
      const rect = canvas.getBoundingClientRect();
      pr.x = e.clientX - rect.left;
      pr.y = e.clientY - rect.top;
      if (speed > speedTrigger) {
        for (const dot of dotsRef.current) {
          if (!dot.busy && Math.hypot(dot.cx - pr.x, dot.cy - pr.y) < proximity) {
            push(dot, dot.cx - pr.x + vx * 0.005, dot.cy - pr.y + vy * 0.005);
          }
        }
      }
      wake();
    };

    const onClick = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (target?.closest(INTERACTIVE)) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      for (const dot of dotsRef.current) {
        const dist = Math.hypot(dot.cx - cx, dot.cy - cy);
        if (dist < shockRadius && !dot.busy) {
          const falloff = Math.max(0, 1 - dist / shockRadius);
          push(dot, (dot.cx - cx) * shockStrength * falloff, (dot.cy - cy) * shockStrength * falloff);
        }
      }
      wake();
    };

    const onLeave = () => {
      pointer.current.x = -9999;
      pointer.current.y = -9999;
      wake();
    };
    const onVisibility = () => {
      if (!document.hidden) wake();
    };

    let last = 0;
    const throttledMove = (e: PointerEvent) => {
      const now = performance.now();
      if (now - last >= 32) {
        last = now;
        onMove(e);
      }
    };

    window.addEventListener("pointermove", throttledMove, { passive: true });
    window.addEventListener("click", onClick);
    document.documentElement.addEventListener("pointerleave", onLeave);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pointermove", throttledMove);
      window.removeEventListener("click", onClick);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      document.removeEventListener("visibilitychange", onVisibility);
      cancelAnimationFrame(l.raf);
      l.running = false;
      for (const dot of dotsRef.current) gsap.killTweensOf(dot);
    };
  }, [reduceMotion, maxSpeed, speedTrigger, proximity, shockRadius, shockStrength, push, wake]);

  return (
    <div ref={wrapperRef} aria-hidden="true" className={`pointer-events-none ${className}`} style={style}>
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
    </div>
  );
}
