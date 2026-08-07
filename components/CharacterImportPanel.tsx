"use client";

import { useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import {
  IMPORT_FORMAT_EXAMPLE,
  previewCharacterImport,
  type CharacterImportEntry,
  type CharacterImportPreview,
} from "@/lib/characterImport";

type Props = {
  onImported: () => void;
};

export default function CharacterImportPanel({ onImported }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<CharacterImportPreview | null>(null);
  const [parseError, setParseError] = useState("");
  const [importError, setImportError] = useState("");
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ imported: number; failed: number } | null>(null);

  function onParse() {
    setParseError("");
    setImportError("");
    setImportResult(null);
    try {
      setPreview(previewCharacterImport(text));
    } catch (err) {
      setPreview(null);
      setParseError(err instanceof Error ? err.message : "Couldn't parse that file.");
    }
  }

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setParseError("");
    setImportError("");
    setImportResult(null);
    try {
      const contents = await file.text();
      setText(contents);
      setPreview(previewCharacterImport(contents));
    } catch (err) {
      setPreview(null);
      setParseError(err instanceof Error ? err.message : "Couldn't read that file.");
    } finally {
      e.target.value = "";
    }
  }

  async function onImport() {
    if (!preview || preview.valid.length === 0 || importing) return;
    setImportError("");
    setImportResult(null);
    setImporting(true);
    try {
      const res = await apiFetch("/api/characters/import", {
        method: "POST",
        body: JSON.stringify({ characters: preview.valid }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setImportError(data.error || "Import failed.");
        return;
      }
      const failed = Array.isArray(data.errors) ? data.errors.length : 0;
      setImportResult({ imported: data.imported ?? 0, failed });
      if ((data.imported ?? 0) > 0) {
        onImported();
        if (failed === 0) {
          setText("");
          setPreview(null);
        }
      }
    } catch {
      setImportError("Couldn't reach the server. Please try again.");
    } finally {
      setImporting(false);
    }
  }

  function loadExample() {
    setText(IMPORT_FORMAT_EXAMPLE);
    setPreview(null);
    setParseError("");
    setImportError("");
    setImportResult(null);
  }

  return (
    <div className="stitched rounded-2xl bg-plum/60 p-6 mb-8 max-w-2xl">
      <div className="flex items-start justify-between gap-4 mb-2">
        <div>
          <p className="font-display text-lg">Import characters</p>
          <p className="text-sm text-parchment/60 mt-1">
            Paste JSON or upload a <code className="text-parchment/80">.json</code> /{" "}
            <code className="text-parchment/80">.txt</code> / <code className="text-parchment/80">.ts</code> file.
            TS/JS export files work too — we extract the array automatically.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="text-sm border border-parchment/30 px-4 py-1.5 rounded-full hover:border-gold focus-ring shrink-0"
        >
          {open ? "Hide" : "Open"}
        </button>
      </div>

      {open && (
        <div className="mt-4 space-y-4">
          <textarea
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setPreview(null);
              setParseError("");
              setImportResult(null);
            }}
            rows={8}
            placeholder={'Paste a JSON array of characters, or the contents of an export file…'}
            className="w-full rounded-lg bg-plum-deep border border-parchment/20 px-3 py-2 text-sm font-mono focus-ring"
          />

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onParse}
              disabled={!text.trim()}
              className="text-sm border border-parchment/30 px-4 py-1.5 rounded-full hover:border-gold focus-ring disabled:opacity-50"
            >
              Preview
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="text-sm border border-parchment/30 px-4 py-1.5 rounded-full hover:border-gold focus-ring"
            >
              Upload file
            </button>
            <button
              type="button"
              onClick={loadExample}
              className="text-sm text-parchment/60 hover:text-gold focus-ring rounded px-2"
            >
              Load example format
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,.txt,.ts,.js,application/json,text/plain"
              className="hidden"
              onChange={onFileChange}
            />
          </div>

          {parseError && (
            <p className="text-sm text-rose bg-rose/10 border border-rose/30 rounded px-3 py-2">{parseError}</p>
          )}

          {preview && (
            <div className="rounded-lg border border-parchment/15 bg-plum-deep/40 p-4">
              <p className="text-sm text-parchment/80 mb-2">
                Ready to import: <span className="text-gold">{preview.valid.length}</span>
                {preview.errors.length > 0 && (
                  <>
                    {" "}
                    · Skipped: <span className="text-rose">{preview.errors.length}</span>
                  </>
                )}
              </p>

              {preview.valid.length > 0 && (
                <ul className="text-xs text-parchment/60 max-h-32 overflow-y-auto space-y-1 mb-3">
                  {preview.valid.map((c: CharacterImportEntry) => (
                    <li key={`${c.name}-${c.tagline}`}>
                      {c.avatarEmoji} {c.name}
                      {c.isExplicit ? " · explicit" : ""}
                    </li>
                  ))}
                </ul>
              )}

              {preview.errors.length > 0 && (
                <ul className="text-xs text-rose/90 max-h-24 overflow-y-auto space-y-1 mb-3">
                  {preview.errors.map((e) => (
                    <li key={`${e.index}-${e.name}`}>
                      {e.error}
                    </li>
                  ))}
                </ul>
              )}

              <button
                type="button"
                onClick={onImport}
                disabled={importing || preview.valid.length === 0}
                className="bg-gold text-ink px-5 py-2 rounded-full text-sm font-medium hover:brightness-110 focus-ring disabled:opacity-50"
              >
                {importing ? "Importing…" : `Import ${preview.valid.length} character${preview.valid.length === 1 ? "" : "s"}`}
              </button>
            </div>
          )}

          {importError && (
            <p className="text-sm text-rose bg-rose/10 border border-rose/30 rounded px-3 py-2">{importError}</p>
          )}

          {importResult && (
            <p className="text-sm text-gold bg-gold/10 border border-gold/30 rounded px-3 py-2">
              Imported {importResult.imported} character{importResult.imported === 1 ? "" : "s"}.
              {importResult.failed > 0 ? ` ${importResult.failed} failed on the server.` : ""}
            </p>
          )}

          <p className="text-xs text-parchment/40">
            Required fields per character: name, personality, backstory, greeting. Optional: tagline, avatarEmoji,
            accentColor, isExplicit, isPublic. Max 50 per import.
          </p>
        </div>
      )}
    </div>
  );
}
