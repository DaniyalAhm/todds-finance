'use client';

import Header from '@/app/components/header';
import { useEffect, useState } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_ACTUAL_API_BASE ?? 'http://localhost:3010';

export default function ConfigurationPage() {
  const [aiServerUrl, setAiServerUrl] = useState('');
  const [aiModel, setAiModel] = useState('');
  const [aiApiKey, setAiApiKey] = useState('');
  const [aiApiKeyConfigured, setAiApiKeyConfigured] = useState(false);
  const [actualSyncId, setActualSyncId] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/api/config`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Could not load configuration');
        return data;
      })
      .then((data) => {
        setAiServerUrl(data.aiServerUrl ?? '');
        setAiModel(data.aiModel ?? '');
        setAiApiKeyConfigured(Boolean(data.aiApiKeyConfigured));
        setActualSyncId(data.actualSyncId ?? '');
      })
      .catch((err) =>
        setMessage(`Error: ${err instanceof Error ? err.message : 'Could not load configuration'}`)
      )
      .finally(() => setLoading(false));
  }, []);

  async function saveConfig() {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(`${API_BASE}/api/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          aiServerUrl,
          aiModel,
          actualSyncId,
          ...(aiApiKey ? { aiApiKey } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save config');
      setAiApiKey('');
      setAiApiKeyConfigured(Boolean(data.config?.aiApiKeyConfigured));
      setMessage('Configuration saved successfully');
    } catch (err) {
      setMessage(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <Header />
      <div className="mx-auto max-w-7xl px-6 py-8">
        <section className="mx-auto w-full max-w-2xl">
          <div className="rounded-3xl border border-zinc-800 bg-zinc-900/80 p-8 shadow-2xl">
            <h2 className="text-2xl font-bold tracking-tight">Configuration</h2>
            <p className="mt-2 text-sm text-zinc-400">
              Configure Open WebUI and your Actual Budget connection.
            </p>

            {loading ? (
              <p className="mt-6 text-zinc-400">Loading configuration...</p>
            ) : (
              <div className="mt-6 flex flex-col gap-5">
                <label className="flex flex-col gap-2">
                  <span className="text-sm font-medium text-zinc-300">Open WebUI API URL</span>
                  <input
                    type="url"
                    value={aiServerUrl}
                    onChange={(e) => setAiServerUrl(e.target.value)}
                    placeholder="http://localhost:3000/api/chat/completions"
                    className="rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-zinc-100 outline-none transition focus:border-violet-400"
                  />
                </label>

                <label className="flex flex-col gap-2">
                  <span className="text-sm font-medium text-zinc-300">Open WebUI Model ID</span>
                  <input
                    type="text"
                    value={aiModel}
                    onChange={(e) => setAiModel(e.target.value)}
                    placeholder="llama3.2"
                    className="rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-zinc-100 outline-none transition focus:border-violet-400"
                  />
                  <span className="text-xs text-zinc-500">
                    Use the exact model ID shown in Open WebUI.
                  </span>
                </label>

                <label className="flex flex-col gap-2">
                  <span className="text-sm font-medium text-zinc-300">Open WebUI API Key</span>
                  <input
                    type="password"
                    value={aiApiKey}
                    onChange={(e) => setAiApiKey(e.target.value)}
                    placeholder={aiApiKeyConfigured ? 'Leave blank to keep current key' : 'Enter API key'}
                    autoComplete="new-password"
                    className="rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-zinc-100 outline-none transition focus:border-violet-400"
                  />
                  <span className="text-xs text-zinc-500">
                    {aiApiKeyConfigured ? 'Currently configured' : 'Not configured'}
                  </span>
                </label>

                <label className="flex flex-col gap-2">
                  <span className="text-sm font-medium text-zinc-300">Actual Sync ID</span>
                  <input
                    type="text"
                    value={actualSyncId}
                    onChange={(e) => setActualSyncId(e.target.value)}
                    placeholder="Your Actual budget sync ID"
                    className="rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-zinc-100 outline-none transition focus:border-violet-400"
                  />
                </label>

                {message && (
                  <div
                    className={`rounded-xl border p-3 text-sm ${
                      message.startsWith('Error')
                        ? 'border-red-800 bg-red-950/50 text-red-200'
                        : 'border-emerald-800 bg-emerald-950/40 text-emerald-200'
                    }`}
                  >
                    {message}
                  </div>
                )}

                <button
                  onClick={saveConfig}
                  disabled={saving}
                  className="rounded-2xl bg-violet-500 px-5 py-3 font-semibold text-white shadow-lg shadow-violet-950/40 transition hover:bg-violet-400 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Save Configuration'}
                </button>
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
