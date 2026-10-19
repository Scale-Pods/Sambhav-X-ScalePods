"use client";

import { useEffect, useState } from "react";

export type ChartTheme = { in: string; out: string; grid: string; axis: string; ink: string; muted: string; card: string; line: string; seq: string[] };

const read = (): ChartTheme => {
  const cs = getComputedStyle(document.documentElement);
  const v = (k: string) => cs.getPropertyValue(k).trim();
  return {
    in: v("--chart-in"), out: v("--chart-out"), grid: v("--chart-grid"), axis: v("--chart-axis"),
    ink: v("--ink"), muted: v("--muted"), card: v("--card"), line: v("--line"),
    seq: [1, 2, 3, 4, 5].map((i) => v(`--seq-${i}`)),
  };
};

const FALLBACK: ChartTheme = { in: "#0a76ad", out: "#f26522", grid: "#ece7e0", axis: "#7a838c", ink: "#18222d", muted: "#66707a", card: "#ffffff", line: "#e7e2da", seq: ["#e3f1f8", "#b9dcee", "#7fc0e1", "#3b97c8", "#0a6797"] };

/** Chart colours from the theme tokens; follows the light / dark switch live. */
export function useChartTheme(): ChartTheme {
  const [t, setT] = useState<ChartTheme>(FALLBACK);
  useEffect(() => {
    setT(read());
    const obs = new MutationObserver(() => setT(read()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);
  return t;
}

export const compact = (v: number) => new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 }).format(v);
export const full = (v: number, digits = 1) => new Intl.NumberFormat("en-IN", { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(v);
