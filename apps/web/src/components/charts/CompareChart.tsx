import { useEffect, useRef } from "react";
import { LineSeries } from "lightweight-charts";
import { byDay, themedChart } from "./theme";

export interface CompareLine {
  label: string;
  color: string;
  points: { time: string; value: number }[];
  dashed?: boolean;
}

/** Two or more lines over the same dates, e.g. what you put in against the same money in an index. */
export function CompareChart({ lines, height = 260 }: { lines: CompareLine[]; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const chart = themedChart(el);
    for (const l of lines) {
      const s = chart.addSeries(LineSeries, {
        color: l.color,
        lineWidth: 2,
        lineStyle: l.dashed ? 2 : 0,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerBorderColor: "#0b0b0d",
        crosshairMarkerBackgroundColor: l.color,
        title: "",
      });
      s.setData(byDay(l.points));
    }
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [lines]);
  return (
    <div>
      <div ref={ref} style={{ height }} className="w-full" />
      <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
        {lines.map((l) => (
          <li key={l.label} className="flex items-center gap-2">
            <span className="h-0.5 w-4 rounded-full" style={{ backgroundColor: l.color }} />
            {l.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
