"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isNvidiaConfigured = isNvidiaConfigured;
exports.getNvidiaKeys = getNvidiaKeys;
exports.streamNvidiaChat = streamNvidiaChat;
exports.completeNvidiaChat = completeNvidiaChat;
const openaiCompatible_1 = require("./openaiCompatible");
const BASE_URL = "https://integrate.api.nvidia.com/v1";
const MODEL = process.env.NVIDIA_MODEL || "meta/llama-3.1-70b-instruct";
function isNvidiaConfigured() {
    return Boolean(process.env.NVIDIA_API_KEY);
}
/**
 * Same idea as getGroqKeys() — second slot is optional. See groq.ts.
 *
 * Returns each configured key tagged with its original 1-based slot number
 * (1 for NVIDIA_API_KEY, 2 for NVIDIA_API_KEY_2), not its position in this
 * filtered array — otherwise, if only NVIDIA_API_KEY_2 is set, that key
 * would end up at array index 0 and get labeled "NVIDIA #1" even though
 * it's really the second key.
 */
function getNvidiaKeys() {
    return [process.env.NVIDIA_API_KEY, process.env.NVIDIA_API_KEY_2]
        .map((key, i) => ({ key, slot: i + 1 }))
        .filter((entry) => Boolean(entry.key));
}
async function streamNvidiaChat(messages, onToken, apiKey, timeoutMs, clientSignal) {
    return (0, openaiCompatible_1.streamOpenAICompatibleChat)(BASE_URL, apiKey, MODEL, messages, onToken, timeoutMs, clientSignal);
}
async function completeNvidiaChat(messages, apiKey, timeoutMs) {
    return (0, openaiCompatible_1.completeOpenAICompatibleChat)(BASE_URL, apiKey, MODEL, messages, timeoutMs);
}
