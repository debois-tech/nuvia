'use client';
import * as echarts from 'echarts/core';
import type { EChartsCoreOption } from 'echarts/core';
import { BarChart, GaugeChart, LineChart, PieChart } from 'echarts/charts';
import { GridComponent, MarkLineComponent, TooltipComponent } from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';
import { useEffect, useRef } from 'react';

// Only what the leadership charts use, bundled with the app. Nothing is loaded from a CDN.
echarts.use([LineChart, BarChart, PieChart, GaugeChart, GridComponent, TooltipComponent, MarkLineComponent, SVGRenderer]);

const reduceMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * One ECharts chart. `label` is the accessible description (the table view carries the exact numbers).
 * While `loading`, the previous drawing stays at reduced opacity so the page doesn't jump.
 */
export function EChart({ option, height, label, loading = false }: { option: EChartsCoreOption; height: number; label: string; loading?: boolean }) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!el.current) return;
    const c = echarts.init(el.current, undefined, { renderer: 'svg' });
    chart.current = c;
    const ro = new ResizeObserver(() => c.resize());
    ro.observe(el.current);
    return () => {
      ro.disconnect();
      c.dispose();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    chart.current?.setOption({ animation: !reduceMotion(), ...option }, { notMerge: true });
  }, [option]);

  return <div ref={el} role="img" aria-label={label} style={{ height, width: '100%', opacity: loading ? 0.55 : 1, transition: 'opacity .15s' }} />;
}
