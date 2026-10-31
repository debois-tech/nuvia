import type { EChartsCoreOption } from 'echarts/core';
import { AXIS, GRID, INK, OTHER, SERIES, SURFACE } from './theme';

export interface Serie {
  name: string;
  data: (number | null)[];
  color: string;
}

type Fmt = (n: number) => string;

/** A tooltip body built with textContent, so names that came from a spreadsheet can never inject markup. */
function tip(title: string, rows: { color: string; name: string; value: string; swatch?: 'line' | 'box' }[]): HTMLElement {
  const root = document.createElement('div');
  root.style.cssText = 'font: 13px/1.4 system-ui, sans-serif; min-width: 150px';
  const h = document.createElement('div');
  h.textContent = title;
  h.style.cssText = `color:${INK.secondary};margin-bottom:4px`;
  root.appendChild(h);
  for (const r of rows) {
    const line = document.createElement('div');
    line.style.cssText = 'display:flex;align-items:center;gap:8px;justify-content:space-between';
    const left = document.createElement('span');
    left.style.cssText = 'display:inline-flex;align-items:center;gap:6px;color:' + INK.secondary;
    const key = document.createElement('i');
    key.style.cssText = r.swatch === 'box' ? `display:inline-block;width:10px;height:10px;border-radius:3px;background:${r.color}` : `display:inline-block;width:12px;height:2px;border-radius:1px;background:${r.color}`;
    const name = document.createElement('span');
    name.textContent = r.name;
    left.append(key, name);
    const val = document.createElement('b');
    val.textContent = r.value;
    val.style.cssText = `color:${INK.primary};font-weight:600`;
    line.append(left, val);
    root.appendChild(line);
  }
  return root;
}

const tooltipBase = { backgroundColor: SURFACE, borderColor: GRID, borderWidth: 1, padding: [8, 12], textStyle: { color: INK.primary }, extraCssText: 'box-shadow:0 6px 20px rgba(0,0,0,.12);border-radius:12px' };

const axisCommon = {
  axisLine: { lineStyle: { color: AXIS, width: 1 } },
  axisTick: { show: false },
  axisLabel: { color: INK.muted, fontSize: 12 },
};

function cartesian(categories: string[], series: any[], fmt: Fmt, axisFmt: Fmt, pointer: 'line' | 'shadow'): EChartsCoreOption {
  const few = categories.length <= (pointer === 'line' ? 5 : 7);
  return {
    color: series.map((s) => s.itemStyle?.color ?? s.lineStyle?.color),
    grid: { left: 8, right: 24, top: 16, bottom: 4, containLabel: true },
    xAxis: {
      type: 'category',
      data: categories,
      boundaryGap: pointer === 'shadow',
      ...axisCommon,
      // Every label when there are few; otherwise ECharts thins them. On line charts the end labels stay inside the card.
      axisLabel: {
        ...axisCommon.axisLabel,
        interval: few ? 0 : 'auto',
        hideOverlap: !few,
        ...(pointer === 'line' ? { alignMinLabel: 'left', alignMaxLabel: 'right' } : {}),
      },
    },
    yAxis: {
      type: 'value',
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: INK.muted, fontSize: 12, formatter: (v: number) => axisFmt(v) },
      splitLine: { lineStyle: { color: GRID, width: 1, type: 'solid' } },
    },
    tooltip: {
      ...tooltipBase,
      trigger: 'axis',
      axisPointer: pointer === 'line' ? { type: 'line', lineStyle: { color: AXIS, width: 1, type: 'solid' } } : { type: 'shadow', shadowStyle: { color: 'rgba(11,11,11,0.04)' } },
      formatter: (params: any) => {
        const list = Array.isArray(params) ? params : [params];
        return tip(
          String(list[0]?.axisValueLabel ?? ''),
          list.filter((p: any) => p.value !== null && p.value !== undefined).map((p: any) => ({ color: p.color, name: p.seriesName, value: fmt(Number(p.value)), swatch: pointer === 'line' ? 'line' : 'box' })),
        );
      },
    },
    series,
  };
}

/** Lines over months. The first series gets a faint area wash when `area` is set. */
export function lineOption(categories: string[], series: Serie[], fmt: Fmt, axisFmt: Fmt, area = false): EChartsCoreOption {
  return cartesian(
    categories,
    series.map((s, i) => ({
      type: 'line',
      name: s.name,
      data: s.data,
      color: s.color,
      lineStyle: { color: s.color, width: 2, cap: 'round', join: 'round' },
      itemStyle: { color: s.color, borderColor: SURFACE, borderWidth: 2 },
      symbol: 'circle',
      symbolSize: 8,
      showAllSymbol: 'auto',
      connectNulls: false,
      emphasis: { focus: 'none' },
      ...(area && i === 0 ? { areaStyle: { color: s.color, opacity: 0.1 } } : {}),
    })),
    fmt,
    axisFmt,
    'line',
  );
}

/** Grouped columns: at most 24px wide, rounded at the top, square on the baseline, a 2px surface gap between neighbours. */
export function barOption(categories: string[], series: Serie[], fmt: Fmt, axisFmt: Fmt): EChartsCoreOption {
  return cartesian(
    categories,
    series.map((s) => ({
      type: 'bar',
      name: s.name,
      data: s.data,
      barMaxWidth: 24,
      barGap: '10%',
      itemStyle: { color: s.color, borderRadius: [4, 4, 0, 0], borderColor: SURFACE, borderWidth: 1 },
      emphasis: { itemStyle: { opacity: 0.85 } },
    })),
    fmt,
    axisFmt,
    'shadow',
  );
}

export interface Slice {
  name: string;
  value: number;
  color: string;
}

/** Part of a whole, up to six slices (the rest folded into "Other" by the caller). The total sits in the middle. */
export function donutOption(slices: Slice[], fmt: Fmt, centre: { value: string; caption: string }): EChartsCoreOption {
  const total = slices.reduce((s, x) => s + x.value, 0);
  return {
    tooltip: {
      ...tooltipBase,
      trigger: 'item',
      formatter: (p: any) => tip(String(p.name), [{ color: p.color, name: `${total ? Math.round((p.value / total) * 1000) / 10 : 0}% of total`, value: fmt(p.value), swatch: 'box' }]),
    },
    title: {
      text: centre.value,
      subtext: centre.caption,
      left: 'center',
      top: '38%',
      itemGap: 2,
      textStyle: { color: INK.primary, fontSize: 22, fontWeight: 500, fontFamily: 'system-ui, sans-serif' },
      subtextStyle: { color: INK.muted, fontSize: 12, fontFamily: 'system-ui, sans-serif' },
    },
    series: [
      {
        type: 'pie',
        radius: ['60%', '82%'],
        avoidLabelOverlap: true,
        label: { show: false },
        labelLine: { show: false },
        itemStyle: { borderColor: SURFACE, borderWidth: 2, borderRadius: 4 },
        emphasis: { scaleSize: 4 },
        data: slices.map((s) => ({ name: s.name, value: s.value, itemStyle: { color: s.color } })),
      },
    ],
  };
}

/** A meter: the filled arc carries the status colour, the unfilled track is a pale tint of the same colour. */
export function gaugeOption(value: number, min: number, max: number, color: string, text: string): EChartsCoreOption {
  return {
    series: [
      {
        type: 'gauge',
        min,
        max,
        startAngle: 205,
        endAngle: -25,
        radius: '98%',
        center: ['50%', '62%'],
        pointer: { show: false },
        progress: { show: true, width: 14, roundCap: true, itemStyle: { color } },
        axisLine: { roundCap: true, lineStyle: { width: 14, color: [[1, `${color}2e`]] } },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: { show: false },
        anchor: { show: false },
        title: { show: false },
        detail: { offsetCenter: [0, '-4%'], fontSize: 26, fontWeight: 500, color: INK.primary, fontFamily: 'system-ui, sans-serif', formatter: () => text },
        data: [{ value: Math.max(min, Math.min(max, value)) }],
      },
    ],
  };
}

/** A small line with no axes, for a stat tile. The latest point is the accent. */
export function sparkOption(values: (number | null)[], color: string): EChartsCoreOption {
  const last = values.length - 1;
  return {
    grid: { left: 2, right: 6, top: 4, bottom: 2 },
    xAxis: { type: 'category', show: false, boundaryGap: false, data: values.map((_, i) => i) },
    yAxis: { type: 'value', show: false, scale: true },
    series: [
      {
        type: 'line',
        data: values.map((v, i) => (i === last && v !== null ? { value: v, symbol: 'circle', symbolSize: 8, itemStyle: { color, borderColor: SURFACE, borderWidth: 2 } } : v)),
        showSymbol: false,
        lineStyle: { color: INK.muted, width: 2, cap: 'round', join: 'round' },
        silent: true,
        animation: false,
        markPoint: undefined,
      },
    ],
  };
}

export const colorFor = (i: number) => SERIES[i % SERIES.length];
export { OTHER };
