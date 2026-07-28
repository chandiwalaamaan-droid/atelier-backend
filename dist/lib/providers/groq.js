"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TTS_VOICES = exports.TTS_MAX_CHARS = void 0;
exports.isGroqConfigured = isGroqConfigured;
exports.getGroqKeys = getGroqKeys;
exports.streamGroqChat = streamGroqChat;
exports.completeGroqChat = completeGroqChat;
exports.synthesizeGroqSpeech = synthesizeGroqSpeech;
exports.splitForSpeech = splitForSpeech;
exports.concatWavBuffers = concatWavBuffers;
const openaiCompatible_1 = require("./openaiCompatible");
const BASE_URL = "https://api.groq.com/openai/v1";
// llama-3.3-70b-versatile was deprecated by Groq on 2026-06-17 and is slated
// for full shutdown by August 2026. Groq's recommended replacement is
// openai/gpt-oss-120b, but gpt-oss has refusals baked in deep and resists
// this app's explicit/NSFW roleplay mode even with a permissive system
// prompt (see the fallback-chain note in ./index.ts). qwen/qwen3.6-27b is
// the other Groq-recommended replacement and — like the Llama models this
// app is built around — has no extra safety layer applied server-side, so
// it's used as the default here instead. Override with GROQ_MODEL if you
// want gpt-oss-120b or anything else.
const MODEL = process.env.GROQ_MODEL || "qwen/qwen3.6-27b";
function isGroqConfigured() {
    return Boolean(process.env.GROQ_API_KEY);
}
/**
 * The two configured Groq API keys, if any. A second key is optional —
 * ideally from a SEPARATE Groq account/signup, since most providers
 * enforce free-tier limits per account, not per key, so two keys from one
 * account may still share a single limit. Leave GROQ_API_KEY_2 unset to
 * just use one key; the slot is then simply left out of the fallback chain.
 *
 * Returns each configured key tagged with its original 1-based slot number
 * rather than its position in this filtered array — otherwise, if only
 * GROQ_API_KEY_2 is set, that key would end up at array index 0 and get
 * labeled "Grok #1" even though it's really the second key.
 */
function getGroqKeys() {
    return [process.env.GROQ_API_KEY, process.env.GROQ_API_KEY_2]
        .map((key, i) => ({ key, slot: i + 1 }))
        .filter((entry) => Boolean(entry.key));
}
async function streamGroqChat(messages, onToken, apiKey, timeoutMs, clientSignal) {
    return (0, openaiCompatible_1.streamOpenAICompatibleChat)(BASE_URL, apiKey, MODEL, messages, onToken, timeoutMs, clientSignal);
}
async function completeGroqChat(messages, apiKey, timeoutMs) {
    return (0, openaiCompatible_1.completeOpenAICompatibleChat)(BASE_URL, apiKey, MODEL, messages, timeoutMs);
}
// ---------------------------------------------------------------------------
// Text-to-speech (Orpheus, via Groq)
// ---------------------------------------------------------------------------
const TTS_MODEL = "canopylabs/orpheus-v1-english";
// Hard limit set by Groq's Orpheus endpoint — inputs over this are rejected outright.
exports.TTS_MAX_CHARS = 200;
exports.TTS_VOICES = ["autumn", "diana", "hannah", "austin", "daniel", "troy"];
/** Synthesizes a single chunk of text (must already be <= TTS_MAX_CHARS) into
 * WAV audio bytes. Callers needing longer text should split it first — see
 * splitForSpeech() in this module. */
async function synthesizeGroqSpeech(text, voice, apiKey, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    try {
        res = await fetch(`${BASE_URL}/audio/speech`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ model: TTS_MODEL, input: text, voice, response_format: "wav" }),
            signal: controller.signal,
        });
    }
    finally {
        clearTimeout(timer);
    }
    if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new Error(`Groq TTS failed (${res.status}): ${errText.slice(0, 300)}`);
    }
    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
}
/** Splits text into chunks that each fit under TTS_MAX_CHARS, preferring to
 * break on sentence boundaries (falling back to a hard split only for a
 * single sentence that's already too long on its own). */
function splitForSpeech(text, maxChars = exports.TTS_MAX_CHARS) {
    const sentences = text.replace(/\s+/g, " ").trim().match(/[^.!?]+[.!?]*\s*/g) ?? [text];
    const chunks = [];
    let current = "";
    for (const raw of sentences) {
        const sentence = raw.trim();
        if (!sentence)
            continue;
        if (sentence.length > maxChars) {
            if (current) {
                chunks.push(current);
                current = "";
            }
            // A single sentence longer than the limit on its own — hard-split on
            // word boundaries as a fallback so nothing gets silently dropped.
            let rest = sentence;
            while (rest.length > maxChars) {
                let cut = rest.lastIndexOf(" ", maxChars);
                if (cut <= 0)
                    cut = maxChars;
                chunks.push(rest.slice(0, cut).trim());
                rest = rest.slice(cut).trim();
            }
            if (rest)
                current = rest;
            continue;
        }
        if ((current + " " + sentence).trim().length > maxChars) {
            chunks.push(current);
            current = sentence;
        }
        else {
            current = (current + " " + sentence).trim();
        }
    }
    if (current)
        chunks.push(current);
    return chunks.filter(Boolean);
}
/** Groq's Orpheus WAV output has a standard RIFF/WAVE/fmt /data layout.
 * Playing several chunks back as one clip needs a single valid WAV file, not
 * several concatenated headers, so this rewrites one combined header over
 * the concatenated PCM payloads instead. */
function concatWavBuffers(buffers) {
    if (buffers.length === 1)
        return buffers[0];
    function findDataChunk(buffer) {
        let offset = 12; // past "RIFF" + size(4) + "WAVE"
        while (offset + 8 <= buffer.length) {
            const chunkId = buffer.toString("ascii", offset, offset + 4);
            const chunkSize = buffer.readUInt32LE(offset + 4);
            if (chunkId === "data") {
                return { headerBeforeData: buffer.subarray(0, offset), data: buffer.subarray(offset + 8, offset + 8 + chunkSize) };
            }
            offset += 8 + chunkSize + (chunkSize % 2); // chunks are word-aligned
        }
        throw new Error("No 'data' chunk found in WAV audio from TTS provider.");
    }
    const parsed = buffers.map(findDataChunk);
    const totalDataLength = parsed.reduce((sum, p) => sum + p.data.length, 0);
    const header = Buffer.from(parsed[0].headerBeforeData); // fmt chunk etc., identical across chunks from the same call
    header.writeUInt32LE(header.length + 8 + totalDataLength - 8, 4); // RIFF chunk size
    const dataTag = Buffer.alloc(8);
    dataTag.write("data", 0, "ascii");
    dataTag.writeUInt32LE(totalDataLength, 4);
    return Buffer.concat([header, dataTag, ...parsed.map((p) => p.data)]);
}
