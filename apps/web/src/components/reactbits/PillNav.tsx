// Adapted from React Bits "PillNav" (reactbits.dev, MIT): a pill-shaped nav whose hovered item
// fills with a rising circle. Changes: a text logo mark (the द) instead of an image, the active
// destination stays filled so you always know where you are, real link semantics
// (aria-current) instead of menu roles, separate track / highlight colours, and the parent
// layout decides placement (no absolute positioning).
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { gsap } from "gsap";

export type PillNavItem = { label: string; href: string; ariaLabel?: string };

export interface PillNavProps {
  logo: ReactNode;
  logoLabel?: string;
  items: PillNavItem[];
  activeHref?: string;
  className?: string;
  ease?: string;
  /** Hover circle, active pill and logo disc. */
  highlightColor?: string;
  /** Text on the highlight. */
  highlightTextColor?: string;
  /** The bar behind the pills. */
  trackColor?: string;
  pillColor?: string;
  pillTextColor?: string;
  initialLoadAnimation?: boolean;
}

export default function PillNav({
  logo,
  logoLabel = "Home",
  items,
  activeHref,
  className = "",
  ease = "power3.out",
  highlightColor = "#f0b23e",
  highlightTextColor = "#16120a",
  trackColor = "#141417",
  pillColor = "#141417",
  pillTextColor = "#f3efe6",
  initialLoadAnimation = true,
}: PillNavProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const circleRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const tlRefs = useRef<Array<gsap.core.Timeline | null>>([]);
  const activeTweenRefs = useRef<Array<gsap.core.Tween | null>>([]);
  const logoMarkRef = useRef<HTMLSpanElement | null>(null);
  const logoTweenRef = useRef<gsap.core.Tween | null>(null);
  const hamburgerRef = useRef<HTMLButtonElement | null>(null);
  const mobileMenuRef = useRef<HTMLDivElement | null>(null);
  const navItemsRef = useRef<HTMLDivElement | null>(null);
  const logoRef = useRef<HTMLAnchorElement | null>(null);

  useEffect(() => {
    const layout = () => {
      circleRefs.current.forEach((circle, index) => {
        if (!circle?.parentElement) return;
        const pill = circle.parentElement;
        const { width: w, height: h } = pill.getBoundingClientRect();
        if (w === 0 || h === 0) return;
        const R = ((w * w) / 4 + h * h) / (2 * h);
        const D = Math.ceil(2 * R) + 2;
        const delta = Math.ceil(R - Math.sqrt(Math.max(0, R * R - (w * w) / 4))) + 1;
        const originY = D - delta;
        circle.style.width = `${D}px`;
        circle.style.height = `${D}px`;
        circle.style.bottom = `-${delta}px`;
        gsap.set(circle, { xPercent: -50, scale: 0, transformOrigin: `50% ${originY}px` });

        const label = pill.querySelector<HTMLElement>(".pill-label");
        const hover = pill.querySelector<HTMLElement>(".pill-label-hover");
        if (label) gsap.set(label, { y: 0 });
        if (hover) gsap.set(hover, { y: Math.ceil(h + 100), opacity: 0 });

        tlRefs.current[index]?.kill();
        const tl = gsap.timeline({ paused: true });
        tl.to(circle, { scale: 1.2, xPercent: -50, duration: 2, ease, overwrite: "auto" }, 0);
        if (label) tl.to(label, { y: -(h + 8), duration: 2, ease, overwrite: "auto" }, 0);
        if (hover) tl.to(hover, { y: 0, opacity: 1, duration: 2, ease, overwrite: "auto" }, 0);
        tlRefs.current[index] = tl;
      });
    };

    layout();
    window.addEventListener("resize", layout);
    document.fonts?.ready.then(layout).catch(() => {});

    if (mobileMenuRef.current) gsap.set(mobileMenuRef.current, { visibility: "hidden", opacity: 0, y: 0 });

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (initialLoadAnimation && !reduce) {
      if (logoRef.current) gsap.fromTo(logoRef.current, { scale: 0 }, { scale: 1, duration: 0.6, ease });
      if (navItemsRef.current) {
        gsap.fromTo(navItemsRef.current, { width: 0, overflow: "hidden" }, { width: "auto", duration: 0.6, ease, clearProps: "overflow" });
      }
    }
    return () => window.removeEventListener("resize", layout);
  }, [items, ease, initialLoadAnimation]);

  const handleEnter = (i: number) => {
    const tl = tlRefs.current[i];
    if (!tl) return;
    activeTweenRefs.current[i]?.kill();
    activeTweenRefs.current[i] = tl.tweenTo(tl.duration(), { duration: 0.3, ease, overwrite: "auto" });
  };
  const handleLeave = (i: number) => {
    const tl = tlRefs.current[i];
    if (!tl) return;
    activeTweenRefs.current[i]?.kill();
    activeTweenRefs.current[i] = tl.tweenTo(0, { duration: 0.2, ease, overwrite: "auto" });
  };
  const handleLogoEnter = () => {
    const mark = logoMarkRef.current;
    if (!mark) return;
    logoTweenRef.current?.kill();
    gsap.set(mark, { rotate: 0 });
    logoTweenRef.current = gsap.to(mark, { rotate: 360, duration: 0.4, ease, overwrite: "auto" });
  };

  const toggleMobile = (next = !mobileOpen) => {
    setMobileOpen(next);
    const lines = hamburgerRef.current?.querySelectorAll(".hamburger-line");
    const [a, b] = lines ? Array.from(lines) : [];
    if (a && b) {
      gsap.to(a, { rotation: next ? 45 : 0, y: next ? 3 : 0, duration: 0.3, ease });
      gsap.to(b, { rotation: next ? -45 : 0, y: next ? -3 : 0, duration: 0.3, ease });
    }
    const menu = mobileMenuRef.current;
    if (!menu) return;
    if (next) {
      gsap.set(menu, { visibility: "visible" });
      gsap.fromTo(menu, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.3, ease, transformOrigin: "top center" });
    } else {
      gsap.to(menu, { opacity: 0, y: 10, duration: 0.2, ease, onComplete: () => void gsap.set(menu, { visibility: "hidden" }) });
    }
  };

  const cssVars = {
    "--hl": highlightColor,
    "--hl-text": highlightTextColor,
    "--track": trackColor,
    "--pill-bg": pillColor,
    "--pill-text": pillTextColor,
    "--nav-h": "44px",
    "--pill-pad-x": "18px",
    "--pill-gap": "3px",
  } as CSSProperties;

  const first = items[0]?.href ?? "/";

  return (
    <div className={`relative ${className}`}>
      <nav className="flex items-center gap-2 lg:w-max lg:gap-0" aria-label="Primary" style={cssVars}>
        <Link
          to={first}
          aria-label={logoLabel}
          onMouseEnter={handleLogoEnter}
          ref={logoRef}
          className="inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full"
          style={{ width: "var(--nav-h)", height: "var(--nav-h)", background: "var(--hl)", color: "var(--hl-text)" }}
        >
          <span ref={logoMarkRef} className="inline-block leading-none">
            {logo}
          </span>
        </Link>

        <div
          ref={navItemsRef}
          className="relative ml-2 hidden items-center rounded-full border border-border lg:flex"
          style={{ height: "var(--nav-h)", background: "var(--track)" }}
        >
          <ul className="m-0 flex h-full list-none items-stretch p-[3px]" style={{ gap: "var(--pill-gap)" }}>
            {items.map((item, i) => {
              const active = activeHref === item.href;
              return (
                <li key={item.href} className="flex h-full">
                  <Link
                    to={item.href}
                    aria-current={active ? "page" : undefined}
                    aria-label={item.ariaLabel || item.label}
                    onMouseEnter={() => !active && handleEnter(i)}
                    onMouseLeave={() => !active && handleLeave(i)}
                    onFocus={() => !active && handleEnter(i)}
                    onBlur={() => !active && handleLeave(i)}
                    className="relative box-border inline-flex h-full cursor-pointer items-center justify-center overflow-hidden rounded-full text-[13px] leading-[0] font-semibold tracking-[0.08em] whitespace-nowrap uppercase no-underline transition-colors duration-300"
                    style={{
                      background: active ? "var(--hl)" : "var(--pill-bg)",
                      color: active ? "var(--hl-text)" : "var(--pill-text)",
                      paddingLeft: "var(--pill-pad-x)",
                      paddingRight: "var(--pill-pad-x)",
                    }}
                  >
                    <span
                      className="pointer-events-none absolute bottom-0 left-1/2 z-[1] block rounded-full"
                      style={{ background: "var(--hl)", willChange: "transform", display: active ? "none" : undefined }}
                      aria-hidden="true"
                      ref={(el) => {
                        circleRefs.current[i] = el;
                      }}
                    />
                    <span className="relative z-[2] inline-block leading-[1]">
                      <span className="pill-label relative z-[2] inline-block leading-[1]" style={{ willChange: "transform" }}>
                        {item.label}
                      </span>
                      <span
                        className="pill-label-hover absolute top-0 left-0 z-[3] inline-block"
                        style={{ color: "var(--hl-text)", willChange: "transform, opacity" }}
                        aria-hidden="true"
                      >
                        {item.label}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>

        <button
          ref={hamburgerRef}
          onClick={() => toggleMobile()}
          aria-label="Open navigation"
          aria-expanded={mobileOpen}
          className="relative flex cursor-pointer flex-col items-center justify-center gap-1 rounded-full border border-border p-0 lg:hidden"
          style={{ width: "var(--nav-h)", height: "var(--nav-h)", background: "var(--track)" }}
        >
          <span className="hamburger-line h-0.5 w-4 origin-center rounded" style={{ background: "var(--pill-text)" }} />
          <span className="hamburger-line h-0.5 w-4 origin-center rounded" style={{ background: "var(--pill-text)" }} />
        </button>
      </nav>

      <div
        ref={mobileMenuRef}
        className="absolute top-[3.5em] left-0 z-[998] w-64 origin-top rounded-[27px] border border-border lg:hidden"
        style={{ ...cssVars, background: "var(--track)" }}
      >
        <ul className="m-0 flex list-none flex-col gap-[3px] p-[3px]">
          {items.map((item) => {
            const active = activeHref === item.href;
            return (
              <li key={item.href}>
                <Link
                  to={item.href}
                  aria-current={active ? "page" : undefined}
                  onClick={() => toggleMobile(false)}
                  className="block rounded-[50px] px-4 py-3 text-[15px] font-medium transition-colors duration-200 hover:bg-raised"
                  style={{ background: active ? "var(--hl)" : undefined, color: active ? "var(--hl-text)" : "var(--pill-text)" }}
                >
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
