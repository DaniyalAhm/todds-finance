'use client';
import Header from '@/app/components/header'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
type AiRule = {
  id?: string;
  selected?: boolean;
  importedPayee?: string;
  matchText?: string;
  payeeName?: string;
  payeeId?: string;
  categoryName?: string;
  categoryId?: string;
  confidence?: number;
  reason?: string;
};

type Transaction = {
  id: string;
  date?: string;
  amount?: number;
  payee?: string;
  payee_name?: string;
  imported_payee?: string;
  category?: string;
  category_name?: string;
  notes?: string;
};

type Category = {
  id: string;
  name: string;
  groupId: string | null;
  groupName: string | null;
  hidden: boolean;
};

type JobError = {
  chunk: number;
  error: string;
  transactions?: Transaction[];
};

type JobProgress = {
  jobId: string;
  status: 'pending' | 'processing' | 'done' | 'error';
  totalChunks: number;
  completedChunks: number;
  rules: AiRule[];
  transactions: Transaction[];
  errors: JobError[];
  summary: string | null;
};

type PushResult = {
  summary: string;
  created: Array<{ rule: AiRule; payeeId: string; categoryId: string | null; actualRuleId: string | null }>;
  errors: Array<{ rule: AiRule; error: string }>;
};

type ApplyResult = {
  jobId: string;
  status: string;
  scanned: number;
  changed: number;
  errors: Array<{ transactionId?: string; date?: string; payee?: string; error: string }>;
  summary: string | null;
  startDate?: string;
  endDate?: string;
  dryRun?: boolean;
  onlyUpdateBlankFields?: boolean;
};

type Tab = 'rules' | 'config';

const API_BASE = process.env.NEXT_PUBLIC_ACTUAL_API_BASE ?? 'http://localhost:3010';

function formatAmount(amount?: number) {
  if (typeof amount !== 'number') return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount / 100);
}

export default function ActualAiRulesPage() {

  const [activeTab, setActiveTab] = useState<Tab>('rules');
  const [chunkSize, setChunkSize] = useState(5);
  const [allowSearch, setAllowSearch] = useState(false);
  const [prompt, setPrompt] = useState(
    'Look at these uncategorized Actual transactions and suggest safe payee/category rules. Prefer conservative rules and explain each suggestion.'
  );

  const [categories, setCategories] = useState<Category[]>([]);
  const [rules, setRules] = useState<AiRule[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [summary, setSummary] = useState<string | null>(null);
  const [jobErrors, setJobErrors] = useState<JobError[]>([]);
  const [loading, setLoading] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pushResult, setPushResult] = useState<PushResult | null>(null);
  const [progress, setProgress] = useState<JobProgress | null>(null);

  const [applyDryRun, setApplyDryRun] = useState(true);
  const [applyBlankOnly, setApplyBlankOnly] = useState(true);
  const [applying, setApplying] = useState(false);
  const [applyResult, setApplyResult] = useState<ApplyResult | null>(null);
  const [applyProgress, setApplyProgress] = useState<ApplyResult | null>(null);
  const applyPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // --- Config state ---
  const [config, setConfig] = useState<{
    actualServerUrl: string;
    actualSyncId: string;
    aiServerUrl: string;
    aiModel: string;
    aiApiKey?: string;
    actualPassword?: string;
    aiApiKeyConfigured?: boolean;
    actualPasswordConfigured?: boolean;
  }>({
    actualServerUrl: '',
    actualSyncId: '',
    aiServerUrl: '',
    aiModel: '',
  });
  const [configLoading, setConfigLoading] = useState(true);
  const [configSaving, setConfigSaving] = useState(false);
  const [configMessage, setConfigMessage] = useState<string | null>(null);

  const selectedRules = useMemo(() => {
    return rules.filter((rule) => rule.selected);
  }, [rules]);

  const groupedCategories = useMemo(() => {
    const grouped = new Map<string, Category[]>();
    for (const cat of categories) {
      const group = cat.groupName ?? 'Other';
      if (!grouped.has(group)) grouped.set(group, []);
      grouped.get(group)!.push(cat);
    }
    return grouped;
  }, [categories]);

  // --- Load config on mount ---
  useEffect(() => {
    fetch(`${API_BASE}/api/config`)
      .then((res) => res.json())
      .then((data) => {
        if (data.actualServerUrl !== undefined) {
          setConfig(data);
        }
      })
      .catch(() => {})
      .finally(() => setConfigLoading(false));
  }, []);

  const pollProgress = useCallback(async (jobId: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/categorize/progress/${jobId}`);
      if (!res.ok) return;
      const data: JobProgress = await res.json();
      setProgress(data);
      setRules(data.rules);
      setTransactions(data.transactions);
      setJobErrors(data.errors);

      if (data.status === 'done' || data.status === 'error') {
        setSummary(data.summary);
        setLoading(false);
        if (pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      }
    } catch {
      // ignore polling errors
    }
  }, []);

  async function requestAiCategorization() {
    setLoading(true);
    setError(null);
    setPushResult(null);
    setRules([]);
    setTransactions([]);
    setSummary(null);
    setJobErrors([]);
    setProgress(null);

    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }

    try {
      const response = await fetch(`${API_BASE}/api/categorize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chunkSize,
          prompt,
          allowSearch,
        }),
      });

      const text = await response.text();

      const data = JSON.parse(text);

      if (!response.ok) {
        throw new Error(data.error || 'Failed to start categorization job');
      }

      pollRef.current = setInterval(() => pollProgress(data.jobId), 1000);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Unknown error');
      setLoading(false);
    }
  }

  // fetch categories on mount
  useEffect(() => {
    fetch(`${API_BASE}/api/actual/categories`)
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) setCategories(data);
      })
      .catch(() => {});
  }, []);

  // cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (applyPollRef.current) clearInterval(applyPollRef.current);
    };
  }, []);

  async function applyRulesToHistory() {
    setApplying(true);
    setError(null);
    setApplyResult(null);
    setApplyProgress(null);

    if (applyPollRef.current) {
      clearInterval(applyPollRef.current);
      applyPollRef.current = null;
    }

    try {
      const res = await fetch(`${API_BASE}/api/actual/apply-rules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dryRun: applyDryRun,
          onlyUpdateBlankFields: applyBlankOnly,
        }),
      });

      const text = await res.text();
      const data = JSON.parse(text);
      if (!res.ok) throw new Error(data.error || 'Failed to start apply job');

      applyPollRef.current = setInterval(async () => {
        try {
          const r = await fetch(`${API_BASE}/api/actual/apply-rules/progress/${data.jobId}`);
          if (!r.ok) return;
          const p = await r.json();
          setApplyProgress(p);
          if (p.status === 'done' || p.status === 'error') {
            setApplyResult(p);
            setApplying(false);
            if (applyPollRef.current) { clearInterval(applyPollRef.current); applyPollRef.current = null; }
          }
        } catch {}
      }, 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setApplying(false);
    }
  }

  async function pushPayeeRulesToActual() {
    if (!selectedRules.length) {
      setError('Select at least one rule before pushing to Actual.');
      return;
    }

    setPushing(true);
    setError(null);
    setPushResult(null);

    try {
      const response = await fetch(`${API_BASE}/api/actual/payee-rules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rules: selectedRules,
        }),
      });

      const text = await response.text();

      const data = JSON.parse(text);

      if (!response.ok) {
        throw new Error(data.error || 'Failed to push payee rules to Actual');
      }

      setPushResult(data as PushResult);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setPushing(false);
    }
  }

  function toggleRule(ruleId: string | undefined) {
    setRules((current) =>
      current.map((rule) =>
        rule.id === ruleId
          ? {
              ...rule,
              selected: !rule.selected,
            }
          : rule
      )
    );
  }

  function updateRule(ruleId: string | undefined, patch: Partial<AiRule>) {
    setRules((current) =>
      current.map((rule) =>
        rule.id === ruleId
          ? {
              ...rule,
              ...patch,
            }
          : rule
      )
    );
  }

  async function saveConfig() {
    setConfigSaving(true);
    setConfigMessage(null);

    try {
      const res = await fetch(`${API_BASE}/api/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save config');
      setConfigMessage('Configuration saved successfully');
    } catch (err) {
      setConfigMessage(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setConfigSaving(false);
    }
  }

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <Header/>
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-6 py-8">

        {activeTab === 'rules' && (
          <>
            <section className="grid gap-4 lg:grid-cols-[420px_1fr]">
              <aside className="rounded-3xl border border-zinc-800 bg-zinc-900/80 p-5 shadow-2xl">
                <h2 className="text-xl font-semibold">AI Request</h2>

                <div className="mt-5 flex flex-col gap-4">
                  <label className="flex flex-col gap-2">
                    <span className="text-sm font-medium text-zinc-300">Chunk size (transactions per AI query)</span>
                    <input
                      type="number"
                      min={1}
                      max={50}
                      value={chunkSize}
                      onChange={(event) => setChunkSize(Number(event.target.value))}
                      className="rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-zinc-100 outline-none transition focus:border-violet-400"
                    />
                  </label>

                  <label className="flex items-center justify-between gap-4 rounded-2xl border border-zinc-800 bg-zinc-950 p-4">
                    <div>
                      <p className="font-medium">Allow search</p>
                      <p className="text-sm text-zinc-500">
                        Let your backend AI route use web/search tools when identifying merchants.
                      </p>
                    </div>

                    <input
                      type="checkbox"
                      checked={allowSearch}
                      onChange={(event) => setAllowSearch(event.target.checked)}
                      className="h-5 w-5 accent-violet-500"
                    />
                  </label>

                  <label className="flex flex-col gap-2">
                    <span className="text-sm font-medium text-zinc-300">Prompt</span>
                    <textarea
                      value={prompt}
                      onChange={(event) => setPrompt(event.target.value)}
                      rows={8}
                      className="resize-none rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-sm leading-6 text-zinc-100 outline-none transition focus:border-violet-400"
                    />
                  </label>

                  <button
                    onClick={requestAiCategorization}
                    disabled={loading}
                    className="rounded-2xl border border-violet-400/50 bg-violet-500/10 px-5 py-3 font-semibold text-violet-100 transition hover:bg-violet-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {loading ? 'Loading transactions...' : 'Refresh AI Suggestions'}
                  </button>

                  <hr className="border-zinc-800" />

                  <div>
                    <h3 className="text-base font-semibold">Apply Rules to History</h3>
                    <p className="mt-1 text-sm text-zinc-500">
                      Run all existing payee rules against historical transactions.
                    </p>
                  </div>

                  <label className="flex items-center justify-between gap-4 rounded-2xl border border-zinc-800 bg-zinc-950 p-4">
                    <div>
                      <p className="font-medium">Dry run</p>
                      <p className="text-sm text-zinc-500">Preview changes without applying them.</p>
                    </div>
                    <input
                      type="checkbox" checked={applyDryRun}
                      onChange={(e) => setApplyDryRun(e.target.checked)}
                      className="h-5 w-5 accent-violet-500"
                    />
                  </label>

                  <label className="flex items-center justify-between gap-4 rounded-2xl border border-zinc-800 bg-zinc-950 p-4">
                    <div>
                      <p className="font-medium">Only fill blank fields</p>
                      <p className="text-sm text-zinc-500">Don&apos;t overwrite existing categories/payees.</p>
                    </div>
                    <input
                      type="checkbox" checked={applyBlankOnly}
                      onChange={(e) => setApplyBlankOnly(e.target.checked)}
                      className="h-5 w-5 accent-violet-500"
                    />
                  </label>

                  <button
                    onClick={applyRulesToHistory}
                    disabled={applying}
                    className="rounded-2xl bg-amber-500 px-5 py-3 font-semibold text-amber-950 transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {applying ? 'Applying...' : applyDryRun ? 'Preview Rules' : 'Apply Rules'}
                  </button>
                </div>
              </aside>

              <section className="flex flex-col gap-4">
                {error && (
                  <div className="rounded-2xl border border-red-800 bg-red-950/50 p-4 text-red-200">
                    <p className="font-semibold">Error</p>
                    <p className="mt-1 text-sm">{error}</p>
                  </div>
                )}

                {pushResult && (
                  <div className="rounded-2xl border border-emerald-800 bg-emerald-950/40 p-4 text-emerald-200">
                    <p className="font-semibold">Rules pushed to Actual</p>
                    <pre className="mt-2 overflow-auto text-xs text-emerald-100">
                      {JSON.stringify(pushResult, null, 2)}
                    </pre>
                  </div>
                )}

                {applyProgress && applying && (
                  <div className="rounded-3xl border border-amber-800 bg-amber-950/40 p-5">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <h2 className="text-xl font-semibold text-amber-200">Applying&hellip;</h2>
                        <p className="mt-1 text-sm text-amber-300">
                          Scanned {applyProgress.scanned} transactions, {applyProgress.changed} matched
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {applyResult && (
                  <div className={`rounded-3xl border p-5 ${applyResult.dryRun ? 'border-amber-800 bg-amber-950/40' : 'border-emerald-800 bg-emerald-950/40'}`}>
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <h2 className={`text-xl font-semibold ${applyResult.dryRun ? 'text-amber-200' : 'text-emerald-200'}`}>
                          {applyResult.dryRun ? 'Preview Results' : 'Rules Applied'}
                        </h2>
                        <p className="mt-1 text-sm text-zinc-400">{applyResult.summary}</p>
                      </div>
                    </div>
                    {applyResult.errors?.length > 0 && (
                      <div className="mt-4 grid gap-2">
                        <p className="text-sm font-semibold text-red-400">Errors ({applyResult.errors.length})</p>
                        {applyResult.errors.map((err: { transactionId?: string; error: string }, i: number) => (
                          <div key={i} className="rounded-xl border border-red-800/50 bg-red-950/60 p-3 text-sm text-red-200">
                            {err.transactionId && <p className="text-xs text-zinc-400">TX: {err.transactionId}</p>}
                            <p>{err.error}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {loading && progress && (
                  <div className="rounded-3xl border border-zinc-800 bg-zinc-900/80 p-5">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <h2 className="text-xl font-semibold">Categorizing&hellip;</h2>
                        <p className="mt-1 text-sm text-zinc-400">
                          {progress.completedChunks} of {progress.totalChunks} AI queries completed
                          {progress.totalChunks > 0 && (
                            <span> ({Math.round((progress.completedChunks / progress.totalChunks) * 100)}%)</span>
                          )}
                        </p>
                      </div>
                      {progress.totalChunks > 0 && (
                        <span className="text-3xl font-bold text-violet-400">
                          {Math.round((progress.completedChunks / progress.totalChunks) * 100)}%
                        </span>
                      )}
                    </div>
                    <div className="mt-4 h-3 w-full overflow-hidden rounded-full bg-zinc-800">
                      <div
                        className="h-full rounded-full bg-violet-500 transition-all duration-500"
                        style={{
                          width: progress.totalChunks > 0
                            ? `${(progress.completedChunks / progress.totalChunks) * 100}%`
                            : '0%',
                        }}
                      />
                    </div>
                  </div>
                )}

                {jobErrors.length > 0 && (
                  <div className="rounded-3xl border border-amber-800 bg-amber-950/40 p-5">
                    <h2 className="text-lg font-semibold text-amber-200">
                      Failures ({jobErrors.length})
                    </h2>
                    <div className="mt-3 grid gap-2">
                      {jobErrors.map((err, i) => (
                        <details key={i} className="rounded-xl border border-amber-800/50 bg-amber-950/60 p-3 text-sm">
                          <summary className="cursor-pointer font-medium text-amber-300">
                            Chunk {err.chunk >= 0 ? err.chunk : 'N/A'}: {err.error.slice(0, 120)}
                          </summary>
                          {err.transactions && err.transactions.length > 0 && (
                            <pre className="mt-2 max-h-40 overflow-auto rounded-lg bg-black/30 p-2 text-xs text-amber-100">
                              {JSON.stringify(err.transactions, null, 2)}
                            </pre>
                          )}
                        </details>
                      ))}
                    </div>
                  </div>
                )}

                {summary && (
                  <div className="rounded-2xl border border-violet-800 bg-violet-950/40 p-4 text-violet-200">
                    <p className="text-sm">{summary}</p>
                  </div>
                )}

                <div className="rounded-3xl border border-zinc-800 bg-zinc-900/80 p-5">
                  <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
                    <div>
                      <h2 className="text-xl font-semibold">Suggested Rules</h2>
                      <p className="mt-1 text-sm text-zinc-400">
                        {selectedRules.length} of {rules.length} selected
                      </p>
                    </div>

                    <button
                      onClick={pushPayeeRulesToActual}
                      disabled={pushing || selectedRules.length === 0}
                      className="rounded-2xl bg-emerald-500 px-5 py-3 font-semibold text-emerald-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {pushing ? 'Pushing...' : 'Push Payee Rules to Actual'}
                    </button>
                  </div>

                  <div className="mt-5 grid gap-4">
                    {loading && (
                      <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-6 text-zinc-400">
                        Asking AI for rule suggestions...
                      </div>
                    )}

                    {!loading && rules.length === 0 && (
                      <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-6 text-zinc-400">
                        No rules yet. Request AI suggestions first.
                      </div>
                    )}

                    {rules.map((rule) => (
                      <article
                        key={rule.id}
                        className="rounded-2xl border border-zinc-800 bg-zinc-950 p-4"
                      >
                        <div className="flex items-start gap-3">
                          <input
                            type="checkbox"
                            checked={Boolean(rule.selected)}
                            onChange={() => toggleRule(rule.id)}
                            className="mt-1 h-5 w-5 accent-violet-500"
                          />

                          <div className="grid flex-1 gap-4 md:grid-cols-2">
                            <label className="flex flex-col gap-2">
                              <span className="text-xs uppercase tracking-wide text-zinc-500">
                                Match imported payee text
                              </span>
                              <input
                                value={rule.matchText ?? rule.importedPayee ?? ''}
                                onChange={(event) =>
                                  updateRule(rule.id, {
                                    matchText: event.target.value,
                                  })
                                }
                                placeholder="AMZN MKTP, HEB, SQ *COFFEE..."
                                className="rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-violet-400"
                              />
                            </label>

                            <label className="flex flex-col gap-2">
                              <span className="text-xs uppercase tracking-wide text-zinc-500">
                                Actual payee name
                              </span>
                              <input
                                value={rule.payeeName ?? ''}
                                onChange={(event) =>
                                  updateRule(rule.id, {
                                    payeeName: event.target.value,
                                  })
                                }
                                placeholder="Amazon"
                                className="rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-violet-400"
                              />
                            </label>

                            {categories.length > 0 ? (
                              <label className="flex flex-col gap-2 md:col-span-2">
                                <span className="text-xs uppercase tracking-wide text-zinc-500">
                                  Category
                                </span>
                                <select
                                  value={rule.categoryId ?? ''}
                                  onChange={(event) => {
                                    const cat = categories.find((c) => c.id === event.target.value);
                                    updateRule(rule.id, {
                                      categoryId: cat?.id ?? undefined,
                                      categoryName: cat?.name ?? undefined,
                                    });
                                  }}
                                  className="rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-violet-400"
                                >
                                  <option value="">— Uncategorized —</option>
                                  {Array.from(groupedCategories.entries()).map(([group, cats]) => (
                                    <optgroup key={group} label={group}>
                                      {cats.map((cat) => (
                                        <option key={cat.id} value={cat.id}>
                                          {cat.name}
                                        </option>
                                      ))}
                                    </optgroup>
                                  ))}
                                </select>
                              </label>
                            ) : (
                              <>
                                <label className="flex flex-col gap-2">
                                  <span className="text-xs uppercase tracking-wide text-zinc-500">
                                    Category name
                                  </span>
                                  <input
                                    value={rule.categoryName ?? ''}
                                    onChange={(event) =>
                                      updateRule(rule.id, {
                                        categoryName: event.target.value,
                                      })
                                    }
                                    placeholder="Shopping"
                                    className="rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-violet-400"
                                  />
                                </label>

                                <label className="flex flex-col gap-2">
                                  <span className="text-xs uppercase tracking-wide text-zinc-500">
                                    Category ID
                                  </span>
                                  <input
                                    value={rule.categoryId ?? ''}
                                    onChange={(event) =>
                                      updateRule(rule.id, {
                                        categoryId: event.target.value,
                                      })
                                    }
                                    placeholder="Actual category UUID"
                                    className="rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-violet-400"
                                  />
                                </label>
                              </>
                            )}
                          </div>
                        </div>

                        <div className="mt-4 rounded-xl bg-zinc-900 p-3 text-sm text-zinc-400">
                          <p>
                            <span className="text-zinc-300">Confidence:</span>{' '}
                            {typeof rule.confidence === 'number'
                              ? `${Math.round(rule.confidence * 100)}%`
                              : '—'}
                          </p>

                          {rule.reason && <p className="mt-1">{rule.reason}</p>}
                        </div>
                      </article>
                    ))}
                  </div>
                </div>

                <div className="rounded-3xl border border-zinc-800 bg-zinc-900/80 p-5">
                  <h2 className="text-xl font-semibold">Transactions Reviewed</h2>

                  <div className="mt-5 overflow-hidden rounded-2xl border border-zinc-800">
                    <div className="grid grid-cols-[120px_1fr_120px_160px] bg-zinc-950 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                      <span>Date</span>
                      <span>Payee</span>
                      <span>Amount</span>
                      <span>Category</span>
                    </div>

                    {transactions.map((transaction) => (
                      <div
                        key={transaction.id}
                        className="grid grid-cols-[120px_1fr_120px_160px] border-t border-zinc-800 px-4 py-3 text-sm"
                      >
                        <span className="text-zinc-400">{transaction.date ?? '—'}</span>
                        <span>
                          {transaction.payee_name ??
                            transaction.payee ??
                            transaction.imported_payee ??
                            'Unknown payee'}
                        </span>
                        <span>{formatAmount(transaction.amount)}</span>
                        <span className="text-zinc-400">
                          {transaction.category_name ?? transaction.category ?? 'Uncategorized'}
                        </span>
                      </div>
                    ))}

                    {!loading && transactions.length === 0 && (
                      <div className="border-t border-zinc-800 px-4 py-6 text-sm text-zinc-500">
                        No transactions loaded.
                      </div>
                    )}
                  </div>
                </div>

                {progress && progress.status === 'done' && (
                  <details className="rounded-3xl border border-zinc-800 bg-zinc-900/80 p-5">
                    <summary className="cursor-pointer text-sm font-semibold text-zinc-300">
                      Raw job response
                    </summary>

                    <pre className="mt-4 max-h-[420px] overflow-auto rounded-2xl bg-zinc-950 p-4 text-xs text-zinc-400">
                      {JSON.stringify(progress, null, 2)}
                    </pre>
                  </details>
                )}
              </section>
            </section>
          </>
        )}

        {activeTab === 'config' && (
          <section className="mx-auto w-full max-w-2xl">
            <div className="rounded-3xl border border-zinc-800 bg-zinc-900/80 p-8 shadow-2xl">
              <h2 className="text-2xl font-bold tracking-tight">Configuration</h2>
              <p className="mt-2 text-sm text-zinc-400">
                Manage your Actual Budget and Open WebUI settings.
              </p>

              {configLoading ? (
                <p className="mt-6 text-zinc-400">Loading configuration...</p>
              ) : (
                <div className="mt-6 flex flex-col gap-5">
                  <label className="flex flex-col gap-2">
                    <span className="text-sm font-medium text-zinc-300">Actual Server URL</span>
                    <input
                      type="text"
                      value={config.actualServerUrl}
                      onChange={(e) => setConfig((prev) => ({ ...prev, actualServerUrl: e.target.value }))}
                      placeholder="https://your-actual-server.com"
                      className="rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-zinc-100 outline-none transition focus:border-violet-400"
                    />
                  </label>

                  <label className="flex flex-col gap-2">
                    <span className="text-sm font-medium text-zinc-300">Actual Sync ID</span>
                    <input
                      type="text"
                      value={config.actualSyncId}
                      onChange={(e) => setConfig((prev) => ({ ...prev, actualSyncId: e.target.value }))}
                      placeholder="Your Actual budget sync ID"
                      className="rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-zinc-100 outline-none transition focus:border-violet-400"
                    />
                  </label>

                  <label className="flex flex-col gap-2">
                    <span className="text-sm font-medium text-zinc-300">Open WebUI API URL</span>
                    <input
                      type="url"
                      value={config.aiServerUrl}
                      onChange={(e) => setConfig((prev) => ({ ...prev, aiServerUrl: e.target.value }))}
                      placeholder="http://localhost:3000/api/chat/completions"
                      className="rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-zinc-100 outline-none transition focus:border-violet-400"
                    />
                  </label>

                  <label className="flex flex-col gap-2">
                    <span className="text-sm font-medium text-zinc-300">Open WebUI Model ID</span>
                    <input
                      type="text"
                      value={config.aiModel}
                      onChange={(e) => setConfig((prev) => ({ ...prev, aiModel: e.target.value }))}
                      placeholder="gemma4:e4b"
                      className="rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-zinc-100 outline-none transition focus:border-violet-400"
                    />
                  </label>

                  <hr className="border-zinc-800" />

                  <p className="text-sm text-zinc-500">
                    The following sensitive fields can also be updated (leave blank to keep current value):
                  </p>

                  <label className="flex flex-col gap-2">
                    <span className="text-sm font-medium text-zinc-300">Open WebUI API Key</span>
                    <input
                      type="password"
                      placeholder="Enter new AI API key"
                      onChange={(e) => setConfig((prev) => ({ ...prev, aiApiKey: e.target.value }))}
                      className="rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-zinc-100 outline-none transition focus:border-violet-400"
                    />
                    <span className="text-xs text-zinc-500">
                      {config.aiApiKeyConfigured ? 'Currently configured' : 'Not configured'}
                    </span>
                  </label>

                  <label className="flex flex-col gap-2">
                    <span className="text-sm font-medium text-zinc-300">Actual Password</span>
                    <input
                      type="password"
                      placeholder="Enter new Actual password"
                      onChange={(e) => setConfig((prev) => ({ ...prev, actualPassword: e.target.value }))}
                      className="rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-zinc-100 outline-none transition focus:border-violet-400"
                    />
                    <span className="text-xs text-zinc-500">
                      {config.actualPasswordConfigured ? 'Currently configured' : 'Not configured'}
                    </span>
                  </label>

                  {configMessage && (
                    <div
                      className={`rounded-xl border p-3 text-sm ${
                        configMessage.startsWith('Error')
                          ? 'border-red-800 bg-red-950/50 text-red-200'
                          : 'border-emerald-800 bg-emerald-950/40 text-emerald-200'
                      }`}
                    >
                      {configMessage}
                    </div>
                  )}

                  <button
                    onClick={saveConfig}
                    disabled={configSaving}
                    className="rounded-2xl bg-violet-500 px-5 py-3 font-semibold text-white shadow-lg shadow-violet-950/40 transition hover:bg-violet-400 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {configSaving ? 'Saving...' : 'Save Configuration'}
                  </button>
                </div>
              )}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
