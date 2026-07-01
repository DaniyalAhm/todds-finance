'use client';

import Header from '@/app/components/header';
import { useEffect, useMemo, useState } from 'react';

type Payee = {
  id: string;
  name: string;
  transferAccountId: string | null;
  isTransfer: boolean;
};

type MergeSuggestion = {
  id: string;
  clusterId: string;
  suggestedTargetId: string;
  members: Payee[];
};

type SuggestionResponse = {
  suggestions: MergeSuggestion[];
  totalPayees: number;
  suggestedGroups: number;
  suggestedPayees: number;
};

type MergeResponse = {
  summary: string;
  merged: Array<{ target: Payee; sources: Payee[] }>;
  errors: Array<{ target: Payee; sources: Payee[]; error: string }>;
};

const API_BASE = process.env.NEXT_PUBLIC_ACTUAL_API_BASE ?? 'http://localhost:3010';

async function requestSuggestions(): Promise<SuggestionResponse> {
  const response = await fetch(`${API_BASE}/api/actual/payee-merge-suggestions`, {
    cache: 'no-store',
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Failed to load merge suggestions');
  return data;
}

function initialTargets(suggestions: MergeSuggestion[]) {
  return Object.fromEntries(
    suggestions.map((suggestion) => [suggestion.id, suggestion.suggestedTargetId])
  );
}

export default function MergePayeesPage() {
  const [suggestions, setSuggestions] = useState<MergeSuggestion[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [targetByGroup, setTargetByGroup] = useState<Record<string, string>>({});
  const [stats, setStats] = useState({ totalPayees: 0, suggestedGroups: 0, suggestedPayees: 0 });
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [pushing, setPushing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pushResult, setPushResult] = useState<MergeResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    requestSuggestions()
      .then((data) => {
        if (cancelled) return;
        setSuggestions(data.suggestions ?? []);
        setSelectedIds((data.suggestions ?? []).map((suggestion) => suggestion.id));
        setTargetByGroup(initialTargets(data.suggestions ?? []));
        setStats({
          totalPayees: data.totalPayees ?? 0,
          suggestedGroups: data.suggestedGroups ?? 0,
          suggestedPayees: data.suggestedPayees ?? 0,
        });
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load suggestions');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function loadSuggestions() {
    setLoading(true);
    setError(null);
    setPushResult(null);
    try {
      const data = await requestSuggestions();
      setSuggestions(data.suggestions ?? []);
      setSelectedIds((data.suggestions ?? []).map((suggestion) => suggestion.id));
      setTargetByGroup(initialTargets(data.suggestions ?? []));
      setStats({
        totalPayees: data.totalPayees ?? 0,
        suggestedGroups: data.suggestedGroups ?? 0,
        suggestedPayees: data.suggestedPayees ?? 0,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load suggestions');
    } finally {
      setLoading(false);
    }
  }

  const visibleSuggestions = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    if (!query) return suggestions;
    return suggestions.filter((suggestion) =>
      suggestion.members.some((member) => member.name.toLocaleLowerCase().includes(query))
    );
  }, [search, suggestions]);

  const selectedSuggestions = useMemo(
    () => suggestions.filter((suggestion) => selectedIds.includes(suggestion.id)),
    [selectedIds, suggestions]
  );

  const selectedPayeeCount = useMemo(
    () => selectedSuggestions.reduce((count, suggestion) => count + suggestion.members.length - 1, 0),
    [selectedSuggestions]
  );

  function toggleSuggestion(id: string) {
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((selectedId) => selectedId !== id) : [...current, id]
    );
    setPushResult(null);
  }

  function toggleAllVisible() {
    const visibleIds = visibleSuggestions.map((suggestion) => suggestion.id);
    const allVisibleSelected = visibleIds.every((id) => selectedIds.includes(id));
    setSelectedIds((current) =>
      allVisibleSelected
        ? current.filter((id) => !visibleIds.includes(id))
        : [...new Set([...current, ...visibleIds])]
    );
    setPushResult(null);
  }

  async function pushSelectedMerges() {
    if (selectedSuggestions.length === 0) return;
    const confirmed = window.confirm(
      `Merge ${selectedPayeeCount} duplicate payees across ${selectedSuggestions.length} groups? This changes Actual Budget and removes the duplicate payees.`
    );
    if (!confirmed) return;

    const selectedGroupIds = new Map(
      selectedSuggestions.map((suggestion) => [targetByGroup[suggestion.id], suggestion.id])
    );
    setPushing(true);
    setError(null);
    setPushResult(null);
    try {
      const response = await fetch(`${API_BASE}/api/actual/merge-payees`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          merges: selectedSuggestions.map((suggestion) => {
            const targetPayeeId = targetByGroup[suggestion.id];
            return {
              targetPayeeId,
              sourcePayeeIds: suggestion.members
                .filter((member) => member.id !== targetPayeeId)
                .map((member) => member.id),
            };
          }),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to merge payees');
      setPushResult(data);

      const completedGroupIds = new Set(
        (data.merged ?? [])
          .map((merge: { target: Payee }) => selectedGroupIds.get(merge.target.id))
          .filter(Boolean)
      );
      const completedPayeeCount = selectedSuggestions
        .filter((group) => completedGroupIds.has(group.id))
        .reduce((count, group) => count + group.members.length, 0);
      setSuggestions((current) => current.filter((group) => !completedGroupIds.has(group.id)));
      setSelectedIds((current) => current.filter((id) => !completedGroupIds.has(id)));
      setStats((current) => ({
        ...current,
        suggestedGroups: Math.max(0, current.suggestedGroups - completedGroupIds.size),
        suggestedPayees: Math.max(0, current.suggestedPayees - completedPayeeCount),
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to merge payees');
    } finally {
      setPushing(false);
    }
  }

  const allVisibleSelected =
    visibleSuggestions.length > 0 &&
    visibleSuggestions.every((suggestion) => selectedIds.includes(suggestion.id));

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <Header />
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-6 py-8">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-medium uppercase tracking-[0.25em] text-violet-300">
              Splink entity resolution
            </p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight">Merge payee suggestions</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">
              Review similar payees detected by Splink, choose the payee to keep in each tree,
              then push selected merges to Actual Budget.
            </p>
          </div>
          <button
            onClick={() => void loadSuggestions()}
            disabled={loading || pushing}
            className="rounded-xl border border-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-300 transition hover:border-zinc-500 hover:text-white disabled:opacity-50"
          >
            {loading ? 'Analyzing...' : 'Run analysis again'}
          </button>
        </header>

        {error && (
          <div className="rounded-2xl border border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        )}

        <section className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-4">
            <p className="text-xs uppercase tracking-wider text-zinc-500">Payees analyzed</p>
            <p className="mt-2 text-2xl font-bold">{stats.totalPayees}</p>
          </div>
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-4">
            <p className="text-xs uppercase tracking-wider text-zinc-500">Suggested groups</p>
            <p className="mt-2 text-2xl font-bold">{stats.suggestedGroups}</p>
          </div>
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-4">
            <p className="text-xs uppercase tracking-wider text-zinc-500">Payees in suggestions</p>
            <p className="mt-2 text-2xl font-bold">{stats.suggestedPayees}</p>
          </div>
        </section>

        {loading ? (
          <section className="rounded-3xl border border-zinc-800 bg-zinc-900/80 p-10 text-center">
            <p className="font-medium text-zinc-300">Splink is analyzing your payees...</p>
            <p className="mt-2 text-sm text-zinc-500">Large budgets can take a minute.</p>
          </section>
        ) : (
          <>
            <section className="flex flex-col gap-3 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 sm:flex-row sm:items-center">
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search suggestions"
                className="min-w-0 flex-1 rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-sm outline-none transition focus:border-violet-400"
              />
              <button
                onClick={toggleAllVisible}
                disabled={visibleSuggestions.length === 0}
                className="rounded-xl border border-zinc-700 px-4 py-3 text-sm font-semibold text-zinc-300 hover:text-white disabled:opacity-40"
              >
                {allVisibleSelected ? 'Deselect visible' : 'Select visible'}
              </button>
            </section>

            <section className="space-y-4">
              {visibleSuggestions.map((suggestion) => {
                const selected = selectedIds.includes(suggestion.id);
                const targetId = targetByGroup[suggestion.id] ?? suggestion.suggestedTargetId;
                const target = suggestion.members.find((member) => member.id === targetId);
                const sources = suggestion.members.filter((member) => member.id !== targetId);

                return (
                  <article
                    key={suggestion.id}
                    className={`rounded-3xl border bg-zinc-900/80 shadow-xl transition ${
                      selected ? 'border-violet-700/70' : 'border-zinc-800 opacity-70'
                    }`}
                  >
                    <div className="flex flex-col gap-4 border-b border-zinc-800 p-5 md:flex-row md:items-center md:justify-between">
                      <label className="flex cursor-pointer items-center gap-3">
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => toggleSuggestion(suggestion.id)}
                          className="h-4 w-4 accent-violet-500"
                        />
                        <span>
                          <span className="block font-semibold">Suggested merge group</span>
                          <span className="text-xs text-zinc-500">
                            Cluster {suggestion.clusterId} · {suggestion.members.length} payees
                          </span>
                        </span>
                      </label>

                      <label className="flex items-center gap-3 text-sm">
                        <span className="whitespace-nowrap text-zinc-400">Keep as canonical</span>
                        <select
                          value={targetId}
                          onChange={(event) => {
                            setTargetByGroup((current) => ({
                              ...current,
                              [suggestion.id]: event.target.value,
                            }));
                            setPushResult(null);
                          }}
                          className="min-w-0 max-w-xs rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 outline-none focus:border-violet-400"
                        >
                          {suggestion.members.map((member) => (
                            <option key={member.id} value={member.id}>{member.name}</option>
                          ))}
                        </select>
                      </label>
                    </div>

                    <div className="p-6" role="tree" aria-label={`Merge tree for ${target?.name}`}>
                      <div className="flex items-center gap-3" role="treeitem" aria-expanded="true" aria-selected="true">
                        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-violet-500/20 text-sm font-bold text-violet-200">
                          ✓
                        </span>
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-violet-100">{target?.name}</p>
                          <p className="text-xs text-zinc-500">Canonical payee · will be kept</p>
                        </div>
                      </div>

                      <div className="ml-4 mt-1 border-l border-zinc-700 pl-7" role="group">
                        {sources.map((source) => (
                          <div
                            key={source.id}
                            className="relative flex items-center gap-3 py-3 before:absolute before:-left-7 before:top-1/2 before:w-5 before:border-t before:border-zinc-700"
                            role="treeitem"
                            aria-selected="false"
                          >
                            <span className="flex h-7 w-7 items-center justify-center rounded-full border border-zinc-700 bg-zinc-950 text-xs text-zinc-500">
                              ↳
                            </span>
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-zinc-300">{source.name}</p>
                              <p className="text-xs text-zinc-600">Will merge into {target?.name}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </article>
                );
              })}

              {visibleSuggestions.length === 0 && (
                <div className="rounded-3xl border border-zinc-800 bg-zinc-900/60 p-10 text-center">
                  <p className="font-medium text-zinc-300">
                    {suggestions.length === 0 ? 'No duplicate payees were suggested.' : 'No suggestions match your search.'}
                  </p>
                  <p className="mt-2 text-sm text-zinc-500">
                    Run the analysis again after new payees are added.
                  </p>
                </div>
              )}
            </section>
          </>
        )}

        {pushResult && (
          <section className="rounded-3xl border border-emerald-900 bg-emerald-950/30 p-6">
            <p className="font-semibold text-emerald-200">{pushResult.summary}</p>
            {pushResult.errors.length > 0 && (
              <ul className="mt-3 space-y-2 text-sm text-red-200">
                {pushResult.errors.map((item, index) => (
                  <li key={`${item.target.id}-${index}`}>{item.target.name}: {item.error}</li>
                ))}
              </ul>
            )}
          </section>
        )}

        <section className="sticky bottom-4 flex flex-col gap-3 rounded-2xl border border-zinc-700 bg-zinc-900/95 p-4 shadow-2xl backdrop-blur sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-semibold">{selectedSuggestions.length} groups selected</p>
            <p className="text-sm text-zinc-500">{selectedPayeeCount} duplicate payees will be merged.</p>
          </div>
          <button
            onClick={pushSelectedMerges}
            disabled={loading || pushing || selectedSuggestions.length === 0}
            className="rounded-2xl bg-violet-500 px-6 py-3 font-semibold text-white shadow-lg shadow-violet-950/40 transition hover:bg-violet-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {pushing ? 'Pushing merges...' : 'Push selected merges to Actual'}
          </button>
        </section>
      </div>
    </main>
  );
}
