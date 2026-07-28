"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isSambanovaConfigured = isSambanovaConfigured;
exports.getSambanovaKeys = getSambanovaKeys;
exports.streamSambanovaChat = streamSambanovaChat;
exports.completeSambanovaChat = completeSambanovaChat;
const openaiCompatible_1 = require("./openaiCompatible");
/**
 * SambaNova Cloud (https://cloud.sambanova.ai) — free tier, no credit card,
 * persists indefinitely (not just a trial). Hosts Meta-Llama-3.3-70B-Instruct
 * (their most battle-tested model) on their own RDU hardware, OpenAI-
 * compatible endpoint. Same rationale as Cerebras: this is a raw Llama model
 * with no extra safety layer applied server-side, so it goes along with
 * explicit-mode roleplay much more readily than Groq's gpt-oss.
 */
const BASE_URL = "https://api.sambanova.ai/v1";
const MODEL = process.env.SAMBANOVA_MODEL || "Meta-Llama-3.3-70B-Instruct";
function isSambanovaConfigured() {
    return Boolean(process.env.SAMBANOVA_API_KEY);
}
/**
 * Same idea as getNvidiaKeys()/getGroqKeys()/getCerebrasKeys() — a second
 * key (SAMBANOVA_API_KEY_2) is optional, ideally from a separate
 * account/signup since free-tier limits are enforced per account, not per
 * key. Leave it unset to just use one key; that slot is then simply left
 * out of the chain.
 *
 * Returns each configured key tagged with its original 1-based slot number,
 * not its position in this filtered array — otherwise, if only
 * SAMBANOVA_API_KEY_2 is set, that key would end up at array index 0 and
 * get labeled "SambaNova #1" even though it's really the second key.
 */
function getSambanovaKeys() {
    return [process.env.SAMBANOVA_API_KEY, process.env.SAMBANOVA_API_KEY_2]
        .map((key, i) => ({ key, slot: i + 1 }))
        .filter((entry) => Boolean(entry.key));
}
async function streamSambanovaChat(messages, onToken, apiKey, timeoutMs, clientSignal) {
    return (0, openaiCompatible_1.streamOpenAICompatibleChat)(BASE_URL, apiKey, MODEL, messages, onToken, timeoutMs, clientSignal);
}
async function completeSambanovaChat(messages, apiKey, timeoutMs) {
    return (0, openaiCompatible_1.completeOpenAICompatibleChat)(BASE_URL, apiKey, MODEL, messages, timeoutMs);
}
