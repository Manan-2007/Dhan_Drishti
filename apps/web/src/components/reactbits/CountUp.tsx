// Adapted from React Bits "CountUp" (reactbits.dev, MIT): a spring-driven number that counts to
// its target. Changes here: a `format` callback so money renders in Indian units, it re-animates
// from the previous value when `to` changes, and it jumps straight to the value when the user has
// asked the OS to reduce motion.
import { useInView, useMotionValue, useReducedMotion, useSpring } from "motion/react";
import { useEffect, useRef } from "react";

interface CountUpProps {
  to: number;
  from?: number;
  delay?: number;
  duration?: number;
  className?: string;
  format?: (value: number) => string;
}

const defaultFormat = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 2 });

export default function CountUp({ to, from = 0, delay = 0, duration = 1.2, className = "", format = defaultFormat }: CountUpProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const reduceMotion = useReducedMotion();
  const motionValue = useMotionValue(reduceMotion ? to : from);
  const springValue = useSpring(motionValue, { damping: 20 + 40 * (1 / duration), stiffness: 100 * (1 / duration) });
  const isInView = useInView(ref, { once: true, margin: "0px" });
  const formatRef = useRef(format);
  formatRef.current = format;

  useEffect(() => {
    if (ref.current && ref.current.textContent === "") ref.current.textContent = formatRef.current(reduceMotion ? to : from);
  }, [from, to, reduceMotion]);

  useEffect(() => {
    if (!isInView) return;
    if (reduceMotion) {
      motionValue.jump(to);
      springValue.jump(to);
      if (ref.current) ref.current.textContent = formatRef.current(to);
      return;
    }
    const id = setTimeout(() => motionValue.set(to), delay * 1000);
    return () => clearTimeout(id);
  }, [isInView, reduceMotion, motionValue, springValue, to, delay]);

  useEffect(
    () =>
      springValue.on("change", (latest: number) => {
        if (ref.current) ref.current.textContent = formatRef.current(latest);
      }),
    [springValue],
  );

  return <span className={className} ref={ref} />;
}
