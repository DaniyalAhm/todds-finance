'use client';

import Header from '@/app/components/header';
import { type PointerEvent, useEffect, useId, useMemo, useState } from 'react';

type BalancePoint = {
  date: string;
  balance: number;
};

type AccountBalance = {
  id: string;
  name: string;
  offbudget: boolean;
  startingBalance: number;
  startingBalanceDate: string | null;
  currentBalance: number;
  openingBalance: number;
  periodChange: number;
  series: BalancePoint[];
};

type BalanceData = {
  days: number;
  startDate: string;
  endDate: string;
  accounts: AccountBalance[];
  merged: {
    currentBalance: number;
    openingBalance: number;
    periodChange: number;
    series: BalancePoint[];
  };
};

type CycleInsights = {
  days: number;
  period: { startDate: string; endDate: string };
  transactionCount: number;
  totals: { income: number; spending: number; net: number };
  insights: {
    summary: string;
    glows: Array<{ title: string; detail: string }>;
    grows: Array<{ title: string; detail: string }>;
  };
};

type BankSyncResult = {
  summary: string;
  synced: Array<{ id: string; name: string }>;
  errors: Array<{ id: string; name: string; error: string }>;
};

const API_BASE = process.env.NEXT_PUBLIC_ACTUAL_API_BASE ?? 'http://localhost:3010';
const PERIODS = [30, 90, 180, 365];
const CHART_COLORS = ['#8b5cf6', '#22d3ee', '#34d399', '#f59e0b', '#f472b6', '#60a5fa', '#a3e635', '#fb7185'];

async function requestBalances(days: number): Promise<BalanceData> {
  const response = await fetch(`${API_BASE}/api/actual/running-balances?days=${days}`, {
    cache: 'no-store',
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Failed to load balances');
  return data;
}

async function requestSavedAnalysis(days: number): Promise<CycleInsights | null> {
  const response = await fetch(`${API_BASE}/api/actual/cycle-insights?days=${days}`, {
    cache: 'no-store',
  });
  if (response.status === 404) return null;
  if (!response.ok) return null;
  return response.json();
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount / 100);
}

function formatDate(date: string) {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(
    new Date(`${date}T00:00:00`)
  );
}

function BalanceChart({
  series,
  color,
  height = 180,
}: {
  series: BalancePoint[];
  color: string;
  height?: number;
}) {
  const rawId = useId();
  const gradientId = `balance-${rawId.replaceAll(':', '')}`;
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const geometry = useMemo(() => {
    if (series.length === 0) return null;
    const width = 800;
    const padding = 12;
    const values = series.map((point) => point.balance);
    const minimum = Math.min(...values);
    const maximum = Math.max(...values);
    const range = maximum - minimum || 1;
    const coordinates = series.map((point, index) => ({
      x: padding + (index / Math.max(1, series.length - 1)) * (width - padding * 2),
      y: padding + ((maximum - point.balance) / range) * (height - padding * 2),
    }));
    const line = coordinates
      .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
      .join(' ');
    const area = `${line} L ${coordinates.at(-1)?.x ?? width - padding} ${height} L ${coordinates[0].x} ${height} Z`;
    return { width, line, area, coordinates, last: coordinates.at(-1), minimum, maximum };
  }, [height, series]);

  if (!geometry) {
    return <div className="flex h-40 items-center justify-center text-sm text-zinc-600">No balance history</div>;
  }

  const hoveredPoint = hoveredIndex === null ? null : series[hoveredIndex];
  const hoveredCoordinate = hoveredIndex === null ? null : geometry.coordinates[hoveredIndex];

  function handlePointerMove(event: PointerEvent<SVGSVGElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const position = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width));
    setHoveredIndex(Math.round(position * Math.max(0, series.length - 1)));
  }

  return (
    <div>
      <div className="mb-2 flex justify-between text-xs text-zinc-600">
        <span>{formatCurrency(geometry.maximum)}</span>
        <span>{formatCurrency(geometry.minimum)}</span>
      </div>
      <div className="relative">
        <svg
          viewBox={`0 0 ${geometry.width} ${height}`}
          className="w-full cursor-crosshair touch-none overflow-visible"
          role="img"
          aria-label="Interactive running balance chart. Hover or use arrow keys to inspect daily balances."
          preserveAspectRatio="none"
          style={{ height }}
          tabIndex={0}
          onPointerMove={handlePointerMove}
          onPointerLeave={() => setHoveredIndex(null)}
          onFocus={() => setHoveredIndex((current) => current ?? series.length - 1)}
          onBlur={() => setHoveredIndex(null)}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
            event.preventDefault();
            const direction = event.key === 'ArrowRight' ? 1 : -1;
            setHoveredIndex((current) =>
              Math.min(series.length - 1, Math.max(0, (current ?? series.length - 1) + direction))
            );
          }}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.3" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <line x1="0" x2={geometry.width} y1={height - 1} y2={height - 1} stroke="#27272a" />
          <path d={geometry.area} fill={`url(#${gradientId})`} />
          <path d={geometry.line} fill="none" stroke={color} strokeWidth="3" vectorEffect="non-scaling-stroke" />
          {hoveredCoordinate ? (
            <>
              <line
                x1={hoveredCoordinate.x}
                x2={hoveredCoordinate.x}
                y1="0"
                y2={height}
                stroke={color}
                strokeOpacity="0.45"
                strokeDasharray="4 4"
                vectorEffect="non-scaling-stroke"
              />
              <circle cx={hoveredCoordinate.x} cy={hoveredCoordinate.y} r="6" fill={color} stroke="#18181b" strokeWidth="3" vectorEffect="non-scaling-stroke" />
            </>
          ) : geometry.last ? (
            <circle cx={geometry.last.x} cy={geometry.last.y} r="5" fill={color} />
          ) : null}
        </svg>

        {hoveredPoint && hoveredCoordinate && (
          <div
            className="pointer-events-none absolute top-2 z-10 -translate-x-1/2 rounded-xl border border-zinc-700 bg-zinc-950/95 px-3 py-2 text-center shadow-xl backdrop-blur"
            style={{
              left: `${Math.min(92, Math.max(8, (hoveredCoordinate.x / geometry.width) * 100))}%`,
            }}
          >
            <p className="whitespace-nowrap text-xs text-zinc-400">{formatDate(hoveredPoint.date)}</p>
            <p className="mt-0.5 whitespace-nowrap text-sm font-bold text-zinc-100">
              {formatCurrency(hoveredPoint.balance)}
            </p>
          </div>
        )}
      </div>
      <div className="mt-2 flex justify-between text-xs text-zinc-600">
        <span>{formatDate(series[0].date)}</span>
        <span>{formatDate(series.at(-1)?.date ?? series[0].date)}</span>
      </div>
    </div>
  );
}

function ChangeBadge({ amount, days }: { amount: number; days: number }) {
  const positive = amount >= 0;
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
      positive ? 'bg-emerald-500/10 text-emerald-300' : 'bg-red-500/10 text-red-300'
    }`}>
      {positive ? '+' : ''}{formatCurrency(amount)} · {days}d
    </span>
  );
}

export default function BalanceDashboardPage() {
  const [days, setDays] = useState(180);
  const [refreshKey, setRefreshKey] = useState(0);
  const [data, setData] = useState<BalanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<BankSyncResult | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [cycleInsights, setCycleInsights] = useState<CycleInsights | null>(null);

  useEffect(() => {
    let cancelled = false;

    const cached = localStorage.getItem(`cycle-insights-${days}`);
    if (cached) {
      try { setCycleInsights(JSON.parse(cached)); } catch { /* ignore */ }
    }

    requestBalances(days)
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load balances');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    requestSavedAnalysis(days).then((saved) => {
      if (!cancelled) {
        if (saved) {
          setCycleInsights(saved);
          localStorage.setItem(`cycle-insights-${days}`, JSON.stringify(saved));
        }
      }
    });

    return () => {
      cancelled = true;
    };
  }, [days, refreshKey]);

  function choosePeriod(period: number) {
    if (period === days) return;
    setDays(period);
    setCycleInsights(null);
    setLoading(true);
    setError(null);
  }

  async function analyzeCycle() {
    setAnalyzing(true);
    setCycleInsights(null);
    setError(null);
    try {
      const response = await fetch(`${API_BASE}/api/actual/cycle-insights`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ days }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Cycle analysis failed");
      setCycleInsights(result);
      localStorage.setItem(`cycle-insights-${days}`, JSON.stringify(result));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cycle analysis failed");
    } finally {
      setAnalyzing(false);
    }
  }

  function dismissAnalysis() {
    setCycleInsights(null);
    localStorage.removeItem(`cycle-insights-${days}`);
  }

  async function syncBanks() {
    setSyncing(true);
    setSyncResult(null);
    setError(null);
    try {
      const response = await fetch(`${API_BASE}/api/actual/bank-sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Bank sync failed");
      setSyncResult(result);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bank sync failed");
    } finally {
      setSyncing(false);
    }
  }

  function refresh() {
    setLoading(true);
    setError(null);
    setRefreshKey((key) => key + 1);
  }

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <Header />
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-6 py-8">
        <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-medium uppercase tracking-[0.25em] text-violet-300">Financial overview</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight">Running balances</h1>
            <p className="mt-2 text-sm text-zinc-400">
              Daily balances rolled forward from each account&apos;s starting balance in Actual Budget.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-xl border border-zinc-800 bg-zinc-900 p-1">
              {PERIODS.map((period) => (
                <button
                  key={period}
                  onClick={() => choosePeriod(period)}
                  className={`rounded-lg px-3 py-2 text-xs font-semibold transition ${
                    days === period ? 'bg-violet-500/20 text-violet-200' : 'text-zinc-500 hover:text-zinc-200'
                  }`}
                >
                  {period === 365 ? '1Y' : `${period}D`}
                </button>
              ))}
            </div>
            <button
              onClick={() => void analyzeCycle()}
              disabled={loading || analyzing}
              className="rounded-xl border border-violet-700 bg-violet-500/10 px-4 py-2 text-sm font-semibold text-violet-200 transition hover:bg-violet-500/20 disabled:opacity-50"
            >
              {analyzing ? "Analyzing cycle..." : `Analyze ${days}D cycle`}
            </button>
            <button
              onClick={() => void syncBanks()}
              disabled={loading || syncing}
              className="rounded-xl bg-violet-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-violet-400 disabled:opacity-50"
            >
              {syncing ? "Syncing banks..." : "Sync banks"}
            </button>
            <button
              onClick={refresh}
              disabled={loading}
              className="rounded-xl border border-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-300 hover:text-white disabled:opacity-50"
            >
              Refresh
            </button>
          </div>
        </header>

        {syncResult && (
          <div className={`rounded-2xl border px-4 py-3 text-sm ${
            syncResult.errors.length > 0
              ? 'border-amber-900 bg-amber-950/40 text-amber-200'
              : 'border-emerald-900 bg-emerald-950/40 text-emerald-200'
          }`}>
            {syncResult.summary}
            {syncResult.errors.length > 0 && (
              <span>
                {' — '}{syncResult.errors.map((item) => `${item.name}: ${item.error}`).join('; ')}
              </span>
            )}
          </div>
        )}

        {error && (
          <div className="rounded-2xl border border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        )}

        {loading && !data ? (
          <div className="rounded-3xl border border-zinc-800 bg-zinc-900/70 p-12 text-center text-zinc-400">
            Loading balances from Actual Budget...
          </div>
        ) : data ? (
          <>
            <section className="overflow-hidden rounded-3xl border border-violet-900/60 bg-gradient-to-br from-violet-950/50 via-zinc-900 to-zinc-900 shadow-2xl">
              <div className="flex flex-col gap-4 border-b border-zinc-800/80 p-6 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-semibold">Combined balance</h2>
                    <span className="rounded-full border border-violet-800/70 bg-violet-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-violet-300">
                      Starting balance roll-forward
                    </span>
                  </div>
                  <p className="mt-2 text-4xl font-bold tracking-tight">{formatCurrency(data.merged.currentBalance)}</p>
                  <p className="mt-1 text-sm text-zinc-500">Across {data.accounts.length} open accounts</p>
                </div>
                <ChangeBadge amount={data.merged.periodChange} days={data.days} />
              </div>
              <div className="p-6">
                <BalanceChart series={data.merged.series} color="#a78bfa" height={260} />
              </div>
            </section>

            {analyzing && (
              <section className="rounded-3xl border border-violet-900/60 bg-violet-950/20 p-8 text-center">
                <p className="font-semibold text-violet-200">Open WebUI is analyzing this cycle...</p>
                <p className="mt-2 text-sm text-zinc-500">
                  Using transactions from the selected {days}-day timeline.
                </p>
              </section>
            )}

            {cycleInsights && (
              <section className="overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-900/75 shadow-xl">
                <div className="border-b border-zinc-800 p-6">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-[0.2em] text-violet-300">
                        Open WebUI cycle review
                      </p>
                      <h2 className="mt-2 text-xl font-semibold">Glows and Grows</h2>
                      <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">
                        {cycleInsights.insights.summary}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="rounded-full border border-zinc-700 px-3 py-1 text-xs text-zinc-400">
                        {formatDate(cycleInsights.period.startDate)}–{formatDate(cycleInsights.period.endDate)} · {cycleInsights.transactionCount} transactions
                      </span>
                      <button
                        onClick={() => void dismissAnalysis()}
                        className="flex h-7 w-7 items-center justify-center rounded-full border border-zinc-700 text-xs text-zinc-500 transition hover:border-red-800 hover:text-red-400"
                        title="Dismiss analysis"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                </div>

                <div className="grid gap-px bg-zinc-800 md:grid-cols-2">
                  <div className="bg-zinc-900 p-6">
                    <div className="flex items-center gap-2">
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-300">✦</span>
                      <h3 className="font-semibold text-emerald-200">Glows</h3>
                    </div>
                    <div className="mt-5 space-y-4">
                      {cycleInsights.insights.glows.map((item, index) => (
                        <article key={`${item.title}-${index}`} className="rounded-2xl border border-emerald-900/60 bg-emerald-950/20 p-4">
                          <h4 className="text-sm font-semibold text-emerald-100">{item.title}</h4>
                          {item.detail && <p className="mt-1 text-sm leading-6 text-zinc-400">{item.detail}</p>}
                        </article>
                      ))}
                    </div>
                  </div>

                  <div className="bg-zinc-900 p-6">
                    <div className="flex items-center gap-2">
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-500/15 text-amber-300">↗</span>
                      <h3 className="font-semibold text-amber-200">Grows</h3>
                    </div>
                    <div className="mt-5 space-y-4">
                      {cycleInsights.insights.grows.map((item, index) => (
                        <article key={`${item.title}-${index}`} className="rounded-2xl border border-amber-900/60 bg-amber-950/20 p-4">
                          <h4 className="text-sm font-semibold text-amber-100">{item.title}</h4>
                          {item.detail && <p className="mt-1 text-sm leading-6 text-zinc-400">{item.detail}</p>}
                        </article>
                      ))}
                    </div>
                  </div>
                </div>
              </section>
            )}

            <section>
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-semibold">Account cards</h2>
                  <p className="mt-1 text-sm text-zinc-500">Individual running balance history</p>
                </div>
                {loading && <span className="text-xs text-violet-300">Updating...</span>}
              </div>

              <div className="grid gap-5 md:grid-cols-1 xl:grid-cols-2">
                {data.accounts.map((account, index) => {
                  const color = CHART_COLORS[index % CHART_COLORS.length];
                  return (
                    <article key={account.id} className="overflow-hidden rounded-4xl border border-zinc-800 bg-zinc-900/75 shadow-xl">
                      <div className="flex items-start justify-between gap-3 border-b border-zinc-800 p-5">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
                            <h3 className="truncate font-semibold">{account.name}</h3>
                          </div>
                          <p className="mt-3 text-2xl font-bold tracking-tight">{formatCurrency(account.currentBalance)}</p>
                          <p className="mt-1 text-xs text-zinc-600">{account.offbudget ? 'Off budget' : 'On budget'}</p>
                          <p className="mt-1 text-xs text-zinc-500">
                            Started at {formatCurrency(account.startingBalance)}
                            {account.startingBalanceDate ? ` on ${formatDate(account.startingBalanceDate)}` : ''}
                          </p>
                        </div>
                        <ChangeBadge amount={account.periodChange} days={data.days} />
                      </div>
                      <div className="p-5">
                        <BalanceChart series={account.series} color={color} height={145} />
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          </>
        ) : null}
      </div>
    </main>
  );
}
