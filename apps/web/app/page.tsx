"use client";

import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type AgentConfig = {
  sources: string[];
  categories: string[];
  limit: number;
  currency: string;
  region?: string;
  useBrowser?: boolean;
  preferences: {
    minOrderSize: number;
    maxOrderSize: number;
  };
};

type AgentRecord = {
  id: string;
  name: string;
  active: boolean;
  config: AgentConfig;
  created_at?: string;
  updated_at?: string;
};

type HealthStatus = {
  name: string;
  url: string;
  status: "ok" | "down" | "unknown";
  latencyMs?: number;
};

const DEFAULT_AGENT_URL = process.env.NEXT_PUBLIC_AGENT_CONFIG_URL ?? "http://localhost:4100";
const DEFAULT_SCRAPER_URL = process.env.NEXT_PUBLIC_SCRAPER_URL ?? "http://localhost:4080";
const DEFAULT_AI_URL = process.env.NEXT_PUBLIC_AI_URL ?? "http://localhost:4090";

export default function Page() {
  const [apiKey, setApiKey] = useState("");
  const [agentUrl, setAgentUrl] = useState(DEFAULT_AGENT_URL);
  const [agents, setAgents] = useState<AgentRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 6;
  const [health, setHealth] = useState<HealthStatus[]>([
    { name: "Agent Config", url: DEFAULT_AGENT_URL, status: "unknown" },
    { name: "Scraper", url: DEFAULT_SCRAPER_URL, status: "unknown" },
    { name: "AI Service", url: DEFAULT_AI_URL, status: "unknown" },
  ]);

  const [form, setForm] = useState({
    id: "",
    name: "",
    categories: "",
    sources: "",
    minOrder: "50",
    maxOrder: "10000",
    currency: "USD",
    limit: "20",
    active: true,
  });
  const [deleteTarget, setDeleteTarget] = useState<AgentRecord | null>(null);

  useEffect(() => {
    const storedKey = localStorage.getItem("sp_api_key");
    const storedUrl = localStorage.getItem("sp_agent_url");
    if (storedKey) setApiKey(storedKey);
    if (storedUrl) setAgentUrl(storedUrl);
  }, []);

  useEffect(() => {
    if (!agentUrl) return;
    localStorage.setItem("sp_agent_url", agentUrl);
  }, [agentUrl]);

  useEffect(() => {
    if (!apiKey) return;
    localStorage.setItem("sp_api_key", apiKey);
  }, [apiKey]);

  const isReady = useMemo(() => apiKey.length >= 16 && agentUrl.length > 0, [apiKey, agentUrl]);

  const fetchAgents = async () => {
    if (!isReady) return;
    setLoading(true);
    try {
      const response = await fetch(`${agentUrl}/agents`, {
        headers: { "x-api-key": apiKey },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as { agents: AgentRecord[] };
      setAgents(data.agents ?? []);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const fetchHealth = async () => {
    const targets = [
      { name: "Agent Config", url: agentUrl },
      { name: "Scraper", url: DEFAULT_SCRAPER_URL },
      { name: "AI Service", url: DEFAULT_AI_URL },
    ];

    const results = await Promise.all(
      targets.map(async (target) => {
        const start = performance.now();
        try {
          const res = await fetch(`${target.url}/health`);
          const latency = Math.round(performance.now() - start);
          if (!res.ok) throw new Error();
          return { ...target, status: "ok" as const, latencyMs: latency };
        } catch {
          return { ...target, status: "down" as const };
        }
      })
    );

    setHealth(results);
  };

  useEffect(() => {
    if (!isReady) return;
    fetchAgents();
    fetchHealth();
  }, [isReady]);

  const submitAgent = async () => {
    if (!isReady) return;
    const payload: AgentRecord = {
      id: form.id.trim(),
      name: form.name.trim(),
      active: form.active,
      config: {
        sources: form.sources.split(",").map((s) => s.trim()).filter(Boolean),
        categories: form.categories.split(",").map((c) => c.trim()).filter(Boolean),
        limit: Number(form.limit) || 20,
        currency: form.currency.trim() || "USD",
        preferences: {
          minOrderSize: Number(form.minOrder) || 0,
          maxOrderSize: Number(form.maxOrder) || 0,
        },
      },
    };

    await fetch(`${agentUrl}/agents`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify(payload),
    });
    await fetchAgents();
  };

  const startEdit = (agent: AgentRecord) => {
    setForm({
      id: agent.id,
      name: agent.name,
      categories: agent.config.categories.join(", "),
      sources: agent.config.sources.join(", "),
      minOrder: String(agent.config.preferences.minOrderSize),
      maxOrder: String(agent.config.preferences.maxOrderSize),
      currency: agent.config.currency,
      limit: String(agent.config.limit),
      active: agent.active,
    });
  };

  const confirmDelete = async () => {
    if (!deleteTarget || !isReady) return;
    await fetch(`${agentUrl}/agents/${deleteTarget.id}`, {
      method: "DELETE",
      headers: { "x-api-key": apiKey },
    });
    setDeleteTarget(null);
    await fetchAgents();
  };

  const filteredAgents = useMemo(() => {
    if (!query.trim()) return agents;
    const term = query.toLowerCase();
    return agents.filter((agent) => {
      return (
        agent.name.toLowerCase().includes(term) ||
        agent.id.toLowerCase().includes(term) ||
        agent.config.sources.join(" ").toLowerCase().includes(term) ||
        agent.config.categories.join(" ").toLowerCase().includes(term)
      );
    });
  }, [agents, query]);

  const totalPages = Math.max(1, Math.ceil(filteredAgents.length / pageSize));
  const pageAgents = filteredAgents.slice((page - 1) * pageSize, page * pageSize);

  return (
    <main className="min-h-screen bg-grid">
      <div className="relative">
        <div className="absolute inset-0 bg-gradient-to-br from-slate-50 via-white to-slate-100" />
        <div className="relative mx-auto flex max-w-6xl flex-col gap-10 px-6 py-12">
          <header className="flex flex-col gap-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="text-sm uppercase tracking-[0.3em] text-slate-500">SourcePilot</p>
                <h1 className="font-display text-4xl text-ink md:text-5xl">Agent Command Center</h1>
              </div>
              <Button size="lg" onClick={submitAgent} disabled={!isReady || !form.id || !form.name}>
                Deploy Agent
              </Button>
            </div>
            <div className="glass-card rounded-3xl p-6 shadow-crisp">
              <div className="grid gap-6 md:grid-cols-3">
                <div>
                  <p className="text-sm text-slate-500">Active agents</p>
                  <p className="font-display text-3xl text-ink">{agents.filter((a) => a.active).length}</p>
                </div>
                <div>
                  <p className="text-sm text-slate-500">Deals reviewed today</p>
                  <p className="font-display text-3xl text-ink">14</p>
                </div>
                <div>
                  <p className="text-sm text-slate-500">Avg. savings</p>
                  <p className="font-display text-3xl text-ink">23%</p>
                </div>
              </div>
              <div className="mt-6 grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-xs font-medium text-slate-500">Agent config URL</label>
                  <Input value={agentUrl} onChange={(e) => setAgentUrl(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-medium text-slate-500">API key</label>
                  <Input value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-3">
                <Button variant="outline" onClick={fetchAgents} disabled={!isReady || loading}>
                  Refresh Agents
                </Button>
                <Button variant="outline" onClick={fetchHealth} disabled={!isReady}>
                  Check Health
                </Button>
                <Input
                  placeholder="Search agents..."
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setPage(1);
                  }}
                />
              </div>
            </div>
          </header>

          <section className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
            <Card className="glass-card">
              <CardHeader className="flex flex-col gap-2">
                <CardTitle className="font-display text-2xl">Active Agents</CardTitle>
                <p className="text-sm text-slate-500">Live policies, sources, and performance.</p>
              </CardHeader>
              <CardContent className="space-y-4">
                {agents.length === 0 && (
                  <div className="rounded-2xl border border-dashed border-slate-200 p-6 text-sm text-slate-500">
                    {isReady ? "No agents found. Create one on the right." : "Enter API key to load agents."}
                  </div>
                )}
                {pageAgents.map((agent) => (
                  <div key={agent.id} className="rounded-2xl border border-slate-200/60 bg-white/80 p-5">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-base font-semibold text-ink">{agent.name}</p>
                        <p className="text-xs text-slate-500">{agent.id}</p>
                      </div>
                      <Badge className={agent.active ? "border-lime-200 text-lime-700" : "border-amber-200 text-amber-700"}>
                        {agent.active ? "Active" : "Paused"}
                      </Badge>
                    </div>
                    <div className="mt-4 grid gap-3 text-sm text-slate-600 md:grid-cols-3">
                      <div>
                        <p className="text-xs uppercase tracking-wide text-slate-400">Sources</p>
                        <p>{agent.config.sources.join(" · ")}</p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-wide text-slate-400">Categories</p>
                        <p>{agent.config.categories.join(" · ")}</p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-wide text-slate-400">Cadence</p>
                        <p>Every 30 mins</p>
                      </div>
                    </div>
                    <div className="mt-4 flex items-center justify-between text-xs text-slate-500">
                      <span>Last update: {agent.updated_at ? new Date(agent.updated_at).toLocaleString() : "—"}</span>
                      <span>Limit: {agent.config.limit}</span>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Button variant="outline" size="sm" onClick={() => startEdit(agent)}>
                        Edit
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(agent)}>
                        Delete
                      </Button>
                    </div>
                  </div>
                ))}
                {filteredAgents.length > pageSize && (
                  <div className="flex items-center justify-between text-sm text-slate-500">
                    <span>
                      Page {page} of {totalPages}
                    </span>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))}>
                        Previous
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
                        Next
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="glass-card">
              <CardHeader className="flex flex-col gap-2">
                <CardTitle className="font-display text-2xl">New Agent Blueprint</CardTitle>
                <p className="text-sm text-slate-500">Define the procurement focus and guardrails.</p>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-medium text-slate-500">Agent name</label>
                  <Input
                    placeholder="e.g. Nairobi · Consumer Electronics"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-medium text-slate-500">Agent ID</label>
                  <Input
                    placeholder="e.g. amara-agent-1"
                    value={form.id}
                    onChange={(e) => setForm({ ...form, id: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-medium text-slate-500">Target categories</label>
                  <Textarea
                    placeholder="Phone cases, screen protectors, charging cables"
                    value={form.categories}
                    onChange={(e) => setForm({ ...form, categories: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-medium text-slate-500">Approved sources</label>
                  <Input
                    placeholder="Alibaba, IndiaMART, Made-in-China"
                    value={form.sources}
                    onChange={(e) => setForm({ ...form, sources: e.target.value })}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-slate-500">Min order</label>
                    <Input
                      placeholder="50"
                      value={form.minOrder}
                      onChange={(e) => setForm({ ...form, minOrder: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-slate-500">Max order</label>
                    <Input
                      placeholder="10,000"
                      value={form.maxOrder}
                      onChange={(e) => setForm({ ...form, maxOrder: e.target.value })}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-slate-500">Scan cadence</label>
                    <Input placeholder="Every 30 mins" disabled />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-slate-500">Currency</label>
                    <Input
                      placeholder="USD"
                      value={form.currency}
                      onChange={(e) => setForm({ ...form, currency: e.target.value })}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-slate-500">Limit</label>
                    <Input
                      placeholder="20"
                      value={form.limit}
                      onChange={(e) => setForm({ ...form, limit: e.target.value })}
                    />
                  </div>
                  <div className="flex items-end">
                    <Button
                      className="w-full"
                      size="lg"
                      onClick={submitAgent}
                      disabled={!isReady || !form.id || !form.name}
                    >
                      Save Agent Policy
                    </Button>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <input
                    type="checkbox"
                    checked={form.active}
                    onChange={(e) => setForm({ ...form, active: e.target.checked })}
                  />
                  <span>Agent active</span>
                </div>
              </CardContent>
            </Card>
          </section>

          <section className="grid gap-6 md:grid-cols-3">
            {health.map((entry) => (
              <Card key={entry.name} className="glass-card">
                <CardHeader>
                  <CardTitle>{entry.name}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between text-sm text-slate-500">
                    <span>{entry.status === "ok" ? "Healthy" : entry.status === "down" ? "Down" : "Unknown"}</span>
                    <span>{entry.latencyMs ? `${entry.latencyMs}ms` : "—"}</span>
                  </div>
                  <p className="mt-2 text-xs text-slate-400">{entry.url}</p>
                </CardContent>
              </Card>
            ))}
          </section>

          <section className="grid gap-6 md:grid-cols-3">
            <Card className="glass-card">
              <CardHeader>
                <CardTitle>Signals</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-slate-500">3 deals flagged for review · 1 anomaly detected</p>
              </CardContent>
            </Card>
            <Card className="glass-card">
              <CardHeader>
                <CardTitle>Escrow Flow</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-slate-500">$12,840 locked · $9,620 released this week</p>
              </CardContent>
            </Card>
            <Card className="glass-card">
              <CardHeader>
                <CardTitle>Agent Health</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-slate-500">All workflows green · latency 1.8s</p>
              </CardContent>
            </Card>
          </section>
        </div>
      </div>
      <Dialog open={Boolean(deleteTarget)} onClose={() => setDeleteTarget(null)}>
        <DialogHeader>
          <DialogTitle>Delete agent?</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-slate-500">This will permanently remove the agent configuration.</p>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setDeleteTarget(null)}>
            Cancel
          </Button>
          <Button onClick={confirmDelete}>Delete</Button>
        </DialogFooter>
      </Dialog>
    </main>
  );
}
