/**
 * Tracks real prompt/completion/cached token counts per provider+model,
 * logged every 60s alongside the existing request-count stats in index.ts
 * (see providerStats/logProviderStats there). This is its own module,
 * separate from index.ts, because openaiCompatible.ts is imported BY
 * index.ts's provider wrappers (groq.ts, nvidia.ts, sambanova.ts,
 * cloudflareChat.ts) — importing index.ts back into openaiCompatible.ts
 * to reuse its stats map would create a circular import.
 *
 * This replaces guesswork ("a Hazelnut reply probably costs ~3.5-5K
 * tokens") with the actual numbers Groq/NVIDIA/SambaNova report back on
 * every request via the standard OpenAI-compatible `usage` field.
 */

interface TokenStats {
  requests: number;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
}

const tokenStats = new Map<string, TokenStats>();

export function recordTokenUsage(
  providerKey: string,
  promptTokens: number,
  completionTokens: number,
  cachedTokens: number = 0
) {
  if (promptTokens <= 0 && completionTokens <= 0) return;
  const stats = tokenStats.get(providerKey) || {
    requests: 0,
    promptTokens: 0,
    completionTokens: 0,
    cachedTokens: 0,
  };
  stats.requests++;
  stats.promptTokens += promptTokens;
  stats.completionTokens += completionTokens;
  stats.cachedTokens += cachedTokens;
  tokenStats.set(providerKey, stats);
}

function logTokenStats() {
  const entries = [...tokenStats.entries()];
  if (entries.length === 0) return;
  console.log("\n[tokens] === Token usage (last 60s) ===");
  for (const [key, stats] of entries) {
    const avgPrompt = Math.round(stats.promptTokens / stats.requests);
    const avgCompletion = Math.round(stats.completionTokens / stats.requests);
    const cachePct =
      stats.promptTokens > 0 ? Math.round((stats.cachedTokens / stats.promptTokens) * 100) : 0;
    console.log(
      `[tokens] ${key.padEnd(24)} | req: ${String(stats.requests).padStart(4)} | ` +
        `avg prompt: ${String(avgPrompt).padStart(5)} | avg completion: ${String(avgCompletion).padStart(4)} | ` +
        `cached: ${String(cachePct).padStart(3)}% | total: ${stats.promptTokens + stats.completionTokens}`
    );
  }
  console.log("[tokens] ==========================================\n");
  for (const [key] of entries) {
    tokenStats.delete(key);
  }
}

setInterval(logTokenStats, 60_000);
