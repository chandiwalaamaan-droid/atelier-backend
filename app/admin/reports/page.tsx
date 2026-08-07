"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import RequireAuth from "@/components/RequireAuth";

type ReportRow = {
  id: string;
  reason: string;
  note: string;
  createdAt: string;
  character: { id: string; name: string; tagline: string; isHidden: boolean; ownerId: string };
  reporter: { displayName: string; email: string };
};

export default function AdminReportsPage() {
  const [reports, setReports] = useState<ReportRow[] | null>(null);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  function load() {
    apiFetch("/api/admin/reports")
      .then(async (r) => {
        if (!r.ok) {
          const data = await r.json().catch(() => ({}));
          throw new Error(data.error || "Couldn't load reports.");
        }
        return r.json();
      })
      .then((data) => setReports(data.reports))
      .catch((err) => setError(err.message || "Couldn't load reports."));
  }

  useEffect(load, []);

  async function resolve(id: string, action: "dismiss" | "hide" | "delete") {
    setBusyId(id);
    try {
      const res = await apiFetch(`/api/admin/reports/${id}/resolve`, {
        method: "POST",
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Couldn't update that report.");
        return;
      }
      load();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <RequireAuth>
      <main className="min-h-screen px-6 py-8 md:px-12">
        <h1 className="font-display text-3xl mb-1">Moderation queue</h1>
        <p className="text-sm text-parchment/60 mb-8">Open reports against shared Discover characters.</p>

        {error && (
          <p className="mb-6 max-w-2xl text-sm text-rose bg-rose/10 border border-rose/30 rounded px-3 py-2">
            {error}
          </p>
        )}

        {reports === null && !error && <p className="text-parchment/60">Loading…</p>}
        {reports?.length === 0 && <p className="text-parchment/60">No open reports.</p>}

        <div className="space-y-4 max-w-3xl">
          {reports?.map((r) => (
            <div key={r.id} className="stitched rounded-2xl bg-plum/60 p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-display text-lg">
                    {r.character.name}{" "}
                    {r.character.isHidden && (
                      <span className="text-xs text-rose ml-2">(hidden)</span>
                    )}
                  </p>
                  <p className="text-xs text-parchment/50 mt-1">
                    Reason: {r.reason.replace(/_/g, " ")} · Reported by {r.reporter.displayName} (
                    {r.reporter.email}) · {new Date(r.createdAt).toLocaleString()}
                  </p>
                  {r.note && <p className="text-sm text-parchment/70 mt-2">"{r.note}"</p>}
                </div>
              </div>
              <div className="flex gap-2 mt-4">
                <button
                  disabled={busyId === r.id}
                  onClick={() => resolve(r.id, "dismiss")}
                  className="text-xs px-3 py-1.5 rounded-full border border-parchment/20 hover:border-parchment/40 focus-ring disabled:opacity-60"
                >
                  Dismiss
                </button>
                <button
                  disabled={busyId === r.id}
                  onClick={() => resolve(r.id, "hide")}
                  className="text-xs px-3 py-1.5 rounded-full border border-gold/40 text-gold hover:bg-gold/10 focus-ring disabled:opacity-60"
                >
                  Keep hidden
                </button>
                <button
                  disabled={busyId === r.id}
                  onClick={() => resolve(r.id, "delete")}
                  className="text-xs px-3 py-1.5 rounded-full border border-rose/40 text-rose hover:bg-rose/10 focus-ring disabled:opacity-60"
                >
                  Delete character
                </button>
              </div>
            </div>
          ))}
        </div>
      </main>
    </RequireAuth>
  );
}
