"use client";

/// <reference types="react" />
import { useEffect, useRef, useState, useCallback, type ReactNode, type FormEvent, type KeyboardEvent } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { apiFetch, resolveMediaUrl } from "@/lib/api";
import RequireAuth from "@/components/RequireAuth";
import ConfirmDialog from "@/components/ConfirmDialog";
import RoleplayModelPicker from "@/components/RoleplayModelPicker";
import MemoryPanel from "@/components/MemoryPanel";
import AppShell from "@/components/AppShell";
import AvatarGenerateModal from "@/components/AvatarGenerateModal";
import {
  loadRoleplayPreferences,
  saveRoleplayPreferences,
  type RoleplayPreferences,
} from "@/lib/roleplayPreferences";
import {
  activeEngineEmoji,
  activeEngineLabel,
  resolveEngineId,
  type RoleplayEngineId,
} from "@/lib/roleplayEngines";

type Character = {
  id: string;
  name: string;
  tagline: string;
  avatarEmoji: string;
  avatarUrl: string | null;
  backgroundUrl: string | null;
  accentColor: string;
  greeting: string;
  isExplicit: boolean;
  roleplayNotes?: string;
  examples?: string;
  tags?: string;
};

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt?: string;
};

type Reaction = { emoji: string; count: number; reacted: boolean };

type ChatTheme = "midnight" | "aurora" | "ember";

const CHAT_THEMES: { id: ChatTheme; label: string; emoji: string }[] = [
  { id: "midnight", label: "Midnight", emoji: "🌙" },
  { id: "aurora", label: "Aurora", emoji: "🌌" },
  { id: "ember", label: "Ember", emoji: "🔥" },
];

const REACTION_EMOJIS = ["❤️", "🔥", "😂", "😮", "😢"];

function getChatTheme(): ChatTheme {
  if (typeof window === "undefined") return "midnight";
  const stored = localStorage.getItem("rolichat:chat:theme");
  if (stored === "midnight" || stored === "aurora" || stored === "ember") return stored;
  return "midnight";
}

function saveChatTheme(theme: ChatTheme) {
  if (typeof window === "undefined") return;
  localStorage.setItem("rolichat:chat:theme", theme);
}

function buildChatBody(
  prefs: RoleplayPreferences,
  payload: Record<string, unknown>
): string {
  const engineSelected = Boolean(prefs.engineId && prefs.engineId !== "custom");
  return JSON.stringify({
    ...payload,
    explicitMode: prefs.explicitMode,
    ...(engineSelected ? { engineId: prefs.engineId } : {}),
    ...(engineSelected || prefs.explicitMode
      ? { spiceLevel: prefs.spiceLevel, roleplayStyle: prefs.roleplayStyle }
      : {}),
  });
}

const MAX_MESSAGE_LENGTH = 4000;

function formatTime(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function renderMessageContent(text: string): ReactNode {
  const lines = text.split("\n");
  return lines.map((line, li) => (
    <span key={li}>
      {renderInline(line)}
      {li < lines.length - 1 && <br />}
    </span>
  ));
}

function renderInline(line: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(`[^`]*`)|(\*\*[^*]*\*\*)|(\*[^*]*\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = pattern.exec(line))) {
    if (match.index > lastIndex) nodes.push(line.slice(lastIndex, match.index));
    const token = match[0];
    if (token.startsWith("`")) {
      nodes.push(
        <code key={key++} className="bg-plum-deep/60 rounded px-1 py-0.5 text-[0.9em] font-mono">
          {token.slice(1, -1)}
        </code>
      );
    } else if (token.startsWith("**")) {
      nodes.push(<strong key={key++}>{token.slice(2, -2)}</strong>);
    } else {
      nodes.push(
        <em key={key++} className="text-parchment/80">
          {token.slice(1, -1)}
        </em>
      );
    }
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < line.length) nodes.push(line.slice(lastIndex));
  return nodes;
}

const MARKER = "\u0000EVT:";

type StreamSegment = { type: "text"; value: string } | { type: "event"; value: Record<string, unknown> };

function extractEvents(buffer: string): { segments: StreamSegment[]; rest: string } {
  const segments: StreamSegment[] = [];
  let rest = buffer;
  while (true) {
    const start = rest.indexOf(MARKER);
    if (start === -1) {
      if (rest) segments.push({ type: "text", value: rest });
      rest = "";
      break;
    }
    if (start > 0) segments.push({ type: "text", value: rest.slice(0, start) });
    const end = rest.indexOf("\u0000", start + MARKER.length);
    if (end === -1) {
      rest = rest.slice(start);
      break;
    }
    const json = rest.slice(start + MARKER.length, end);
    try {
      segments.push({ type: "event", value: JSON.parse(json) });
    } catch {
      /* malformed event, drop it silently */
    }
    rest = rest.slice(end + 1);
  }
  return { segments, rest };
}

export default function ChatPage() {
  const { characterId } = useParams<{ characterId: string }>();
  const router = useRouter();
  const [character, setCharacter] = useState<Character | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [notFound, setNotFound] = useState(false);
  const [toast, setToast] = useState("");
  const [showJump, setShowJump] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [roleplayPrefs, setRoleplayPrefs] = useState<RoleplayPreferences>(() =>
    characterId ? loadRoleplayPreferences(characterId, false) : loadRoleplayPreferences("", false)
  );
  const [enginePickerOpen, setEnginePickerOpen] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [avatarModalOpen, setAvatarModalOpen] = useState(false);
  const [loadingAudioId, setLoadingAudioId] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [voiceError, setVoiceError] = useState("");
  const audioCacheRef = useRef<Map<string, string>>(new Map());
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [theme, setTheme] = useState<ChatTheme>(getChatTheme);
  const [reactions, setReactions] = useState<Map<string, Reaction[]>>(new Map());
  const [showQuickActions, setShowQuickActions] = useState(false);
  const [relationshipLevel, setRelationshipLevel] = useState(0);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<{ displayName: string; email: string } | null>(null);
  const [chatMenuOpen, setChatMenuOpen] = useState(false);
  const [expandedAvatar, setExpandedAvatar] = useState<string | null>(null);

  const editTextareaRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const quickActionsRef = useRef<HTMLDivElement>(null);
  const sendingRef = useRef(false);

  useEffect(() => {
    document.documentElement.setAttribute("data-chat-theme", theme);
    saveChatTheme(theme);
  }, [theme]);

  useEffect(() => {
    if (!openMenuId) return;
    function onClick(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (!target.closest(".message-menu")) setOpenMenuId(null);
    }
    window.addEventListener("click", onClick, true);
    return () => window.removeEventListener("click", onClick, true);
  }, [openMenuId]);

  useEffect(() => {
    const controller = new AbortController();
    apiFetch(`/api/chat/${characterId}`, { signal: controller.signal })
      .then(async (r) => {
        if (r.status === 401) {
          router.replace(`/login?next=/chat/${characterId}`);
          return null;
        }
        if (!r.ok) {
          setNotFound(true);
          return null;
        }
        return r.json();
      })
      .then((data) => {
        if (!data) return;
        setCharacter(data.character);
        setMessages(data.messages);
        if (typeof data.relationshipLevel === "number") setRelationshipLevel(data.relationshipLevel);
        const prefs = loadRoleplayPreferences(characterId, data.character.isExplicit ?? false);
        setRoleplayPrefs(prefs);
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        console.error("Failed to load chat:", err);
      });
    return () => controller.abort();
  }, [characterId]);

  useEffect(() => {
    if (!character) return;
    saveRoleplayPreferences(character.id, roleplayPrefs);
  }, [character, roleplayPrefs]);

  useEffect(() => {
    apiFetch("/api/auth/me")
      .then(async (r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => setCurrentUser(data.user ?? null))
      .catch(() => setCurrentUser(null));
  }, [characterId]);

  useEffect(() => {
    if (!chatMenuOpen) return;
    function onClick(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (!target.closest(".chat-menu")) {
        setChatMenuOpen(false);
      }
    }
    window.addEventListener("click", onClick, true);
    return () => window.removeEventListener("click", onClick, true);
  }, [chatMenuOpen]);

  useEffect(() => {
    if (!expandedAvatar) return;
    function onKeyDown(e: globalThis.KeyboardEvent) {
      if (e.key === "Escape") setExpandedAvatar(null);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [expandedAvatar]);

  function applyEnginePrefs(prefs: RoleplayPreferences, engineId: RoleplayEngineId) {
    setRoleplayPrefs({ ...prefs, engineId });
  }

  const displayEngineId = roleplayPrefs.engineId ?? resolveEngineId(roleplayPrefs);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    bottomRef.current?.scrollIntoView({ behavior });
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 200;
    if (nearBottom) scrollToBottom();
  }, [messages, scrollToBottom]);

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    setShowJump(el.scrollHeight - el.scrollTop - el.clientHeight > 300);
  }

  function showToast(text: string) {
    setToast(text);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 3500);
  }

  function autoResize() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  }

  const lastActionRef = useRef<{ type: "send"; text: string; sceneDirective?: string } | { type: "regenerate" } | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  function isAbortError(err: unknown) {
    return err instanceof DOMException && err.name === "AbortError";
  }

  function stopGenerating() {
    abortControllerRef.current?.abort();
  }

  async function runStream(
    res: Response,
    assistantId: string,
    onFatal: (message: string) => void
  ) {
    if (!res.ok || !res.body) {
      const data = await res.json().catch(() => ({}));
      const message = data.error || "Something went wrong.";
      setError(message);
      onFatal(message);
      setSending(false);
      sendingRef.current = false;
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let acc = "";
    let carry = "";

    // Streaming replies can arrive as dozens-to-hundreds of small chunks
    // (especially on the longer, more elaborate 18+ engines). Calling
    // setMessages on every single chunk forces a full re-render of the
    // entire message list on every chunk, which saturates the main thread
    // and freezes the tab on mobile / blocks clicks on desktop. Instead,
    // accumulate text locally and flush to React state at most once per
    // animation frame.
    let rafId: number | null = null;
    let pendingFlush = false;

    const flush = () => {
      rafId = null;
      pendingFlush = false;
      setMessages((prev: Message[]) =>
        prev.map((m) => (m.id === assistantId ? { ...m, content: acc } : m))
      );
    };

    const scheduleFlush = () => {
      if (pendingFlush) return;
      pendingFlush = true;
      rafId = requestAnimationFrame(flush);
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        carry += decoder.decode(value, { stream: true });
        const { segments, rest } = extractEvents(carry);
        carry = rest;
        for (const seg of segments) {
          if (seg.type === "text") {
            acc += seg.value;
            continue;
          }
          const ev = seg.value;
          if (ev.type === "failover") {
            acc = "";
            showToast("Reconnecting to keep the reply on track…");
          } else if (ev.type === "fatal") {
            const message = typeof ev.message === "string" ? ev.message : "Something went wrong.";
            setError(message);
            onFatal(message);
          } else if (ev.type === "relationship" && typeof ev.level === "number") {
            setRelationshipLevel(ev.level);
          }
        }
        scheduleFlush();
      }
    } finally {
      // Guarantee a final, synchronous flush so the last chunk(s) that
      // arrived between the last rAF tick and stream end are never dropped.
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      setMessages((prev: Message[]) =>
        prev.map((m) => (m.id === assistantId ? { ...m, content: acc } : m))
      );
    }
  }

  async function refreshMessages() {
    try {
      const r = await apiFetch(`/api/chat/${characterId}`);
      if (!r.ok) return;
      const data = await r.json();
      setMessages(data.messages);
    } catch {
      // best-effort sync; ignore transient failures
    }
  }

  async function sendMessage(userText: string, sceneDirective?: string) {
    setError("");
    sendingRef.current = true;
    setSending(true);
    lastActionRef.current = { type: "send", text: userText, sceneDirective };

    const showUserBubble = Boolean(userText.trim());
    const userMsg: Message | null = showUserBubble
      ? { id: `local-${Date.now()}`, role: "user", content: userText }
      : null;
    const assistantId = `local-${Date.now()}-a`;
    const assistantMsg: Message = { id: assistantId, role: "assistant", content: "" };
    setMessages((prev: Message[]) => [...prev, ...(userMsg ? [userMsg] : []), assistantMsg]);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const res = await apiFetch(`/api/chat/${characterId}`, {
        method: "POST",
        body: buildChatBody(roleplayPrefs, {
          message: userText,
          ...(sceneDirective ? { sceneDirective } : {}),
        }),
        signal: controller.signal,
      });
      await runStream(res, assistantId, () =>
        setMessages((prev: Message[]) => prev.filter((m) => m.id !== assistantId))
      );
    } catch (err) {
      if (!isAbortError(err)) {
        setError("Lost connection while streaming the reply.");
        setMessages((prev: Message[]) => prev.filter((m) => m.id !== assistantId));
      }
    } finally {
      setSending(false);
      sendingRef.current = false;
      abortControllerRef.current = null;
      await refreshMessages();
    }
  }

  async function steerScene(directive: string) {
    if (sendingRef.current || messages.length === 0) return;
    await sendMessage("", directive);
  }

  async function retryFailedSend() {
    const action = lastActionRef.current;
    if (!action || action.type !== "send" || sendingRef.current) return;
    sendingRef.current = true;
    setError("");
    setSending(true);
    const assistantId = `local-${Date.now()}-a`;
    const assistantMsg: Message = { id: assistantId, role: "assistant", content: "" };
    setMessages((prev: Message[]) => [...prev, assistantMsg]);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const res = await apiFetch(`/api/chat/${characterId}`, {
        method: "POST",
        body: buildChatBody(roleplayPrefs, {
          message: action.text,
          ...(action.sceneDirective ? { sceneDirective: action.sceneDirective } : {}),
        }),
        signal: controller.signal,
      });
      await runStream(res, assistantId, () =>
        setMessages((prev: Message[]) => prev.filter((m) => m.id !== assistantId))
      );
    } catch (err) {
      if (!isAbortError(err)) {
        setError("Lost connection while streaming the reply.");
        setMessages((prev: Message[]) => prev.filter((m) => m.id !== assistantId));
      }
    } finally {
      setSending(false);
      sendingRef.current = false;
      abortControllerRef.current = null;
      await refreshMessages();
    }
  }

  async function onSend(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!input.trim() || sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    const userText = input.trim();
    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    await sendMessage(userText);
  }

  async function onRegenerate() {
    if (sendingRef.current || messages.length === 0) return;
    const last = messages[messages.length - 1];
    if (last.role !== "assistant") return;
    const previousContent = last.content;

    setError("");
    setSending(true);
    lastActionRef.current = { type: "regenerate" };
    setMessages((prev: Message[]) => prev.map((m, i) => (i === prev.length - 1 ? { ...m, content: "" } : m)));

    const restore = () => setMessages((prev: Message[]) => prev.map((m) => (m.id === last.id ? { ...m, content: previousContent } : m)));

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const res = await apiFetch(`/api/chat/${characterId}`, {
        method: "POST",
        body: buildChatBody(roleplayPrefs, { regenerate: true }),
        signal: controller.signal,
      });
      await runStream(res, last.id, restore);
    } catch (err) {
      if (!isAbortError(err)) {
        setError("Lost connection while regenerating the reply.");
        restore();
      }
    } finally {
      setSending(false);
      sendingRef.current = false;
      abortControllerRef.current = null;
      await refreshMessages();
    }
  }

  async function onRetry() {
    const action = lastActionRef.current;
    if (!action || sendingRef.current) return;
    if (action.type === "send") await retryFailedSend();
    else await onRegenerate();
  }

  function onResetConversation() {
    setResetConfirmOpen(true);
  }

  function exportChat() {
    if (!character || messages.length === 0) return;
    const lines = messages.map((m) => {
      const time = m.createdAt ? `[${formatTime(m.createdAt)}] ` : "";
      const role = m.role === "user" ? currentUser?.displayName || "You" : character.name;
      return `${time}${role}: ${m.content}`;
    });
    const blob = new Blob([lines.join("\n\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${character.name} - Chat Export.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function confirmResetConversation() {
    setResetConfirmOpen(false);
    setResetting(true);
    try {
      const r = await apiFetch(`/api/chat/${characterId}`, { method: "DELETE" });
      const data = await r.json().catch(() => ({}));
      setMessages([]);
      setRelationshipLevel(typeof data.relationshipLevel === "number" ? data.relationshipLevel : 0);
      setError("");
    } finally {
      setResetting(false);
    }
  }

  function toggleMenu(id: string) {
    setOpenMenuId((prev) => (prev === id ? null : id));
  }

  function confirmDelete(id: string) {
    setDeleteTargetId(id);
    setDeleteConfirmOpen(true);
  }

  async function onDeleteMessage() {
    if (!deleteTargetId) return;
    setDeleteConfirmOpen(false);
    try {
      const r = await apiFetch(`/api/chat/${characterId}/messages/${deleteTargetId}`, { method: "DELETE" });
      const data = await r.json().catch(() => ({}));
      setMessages((prev) => prev.filter((m) => m.id !== deleteTargetId));
      if (typeof data.relationshipLevel === "number") setRelationshipLevel(data.relationshipLevel);
    } catch {
      setError("Couldn't delete that message.");
    } finally {
      setDeleteTargetId(null);
    }
  }

  function startEdit(id: string, content: string) {
    if (sendingRef.current) return;
    setEditingId(id);
    setEditDraft(content);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditDraft("");
  }

  async function submitEdit(id: string) {
    const newContent = editDraft.trim();
    if (!newContent || savingEdit) return;

    const editedIndex = messages.findIndex((m) => m.id === id);
    if (editedIndex === -1) return;
    const previousMessages = messages;

    setSavingEdit(true);
    setError("");
    const assistantId = `local-${Date.now()}-a`;
    setMessages((prev: Message[]) => [
      ...prev.slice(0, editedIndex).concat({ ...prev[editedIndex], content: newContent }),
      { id: assistantId, role: "assistant", content: "" },
    ]);
    setEditingId(null);
    setEditDraft("");
    setSending(true);
    lastActionRef.current = { type: "regenerate" };

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const res = await apiFetch(`/api/chat/${characterId}`, {
        method: "POST",
        body: buildChatBody(roleplayPrefs, { editMessageId: id, editContent: newContent }),
        signal: controller.signal,
      });
      await runStream(res, assistantId, (message) => {
        setError(message);
        setMessages(previousMessages);
      });
    } catch (err) {
      if (!isAbortError(err)) {
        setError("Lost connection while saving the edit.");
        setMessages(previousMessages);
      }
    } finally {
      setSavingEdit(false);
      setSending(false);
      sendingRef.current = false;
      abortControllerRef.current = null;
      await refreshMessages();
    }
  }

  function autoResizeEdit() {
    const el = editTextareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  }

  async function onSpeak(id: string, content: string) {
    setVoiceError("");
    const audioEl = audioElRef.current;
    if (!audioEl) return;

    if (playingId === id) {
      audioEl.pause();
      setPlayingId(null);
      return;
    }

    const cached = audioCacheRef.current.get(id);
    if (cached) {
      audioEl.src = cached;
      audioEl.play().catch(() => {
        setVoiceError("Failed to play audio.");
        setPlayingId(null);
      });
      setPlayingId(id);
      return;
    }

    setLoadingAudioId(id);
    try {
      const res = await apiFetch(`/api/chat/${characterId}/speak`, {
        method: "POST",
        body: JSON.stringify({ text: content }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setVoiceError(data.error || "Couldn't generate audio.");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const cache = audioCacheRef.current;
      cache.set(id, url);
      if (cache.size > 20) {
        const oldest = cache.keys().next().value!;
        URL.revokeObjectURL(cache.get(oldest)!);
        cache.delete(oldest);
      }
      audioEl.src = url;
      audioEl.play().catch(() => {
        setVoiceError("Failed to play audio.");
        setPlayingId(null);
      });
      setPlayingId(id);
    } catch {
      setVoiceError("Couldn't reach the server for voice playback.");
    } finally {
      setLoadingAudioId(null);
    }
  }

  useEffect(() => {
    const cache = audioCacheRef.current;
    return () => {
      cache.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  async function onCopy(id: string, content: string) {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedId(id);
      setTimeout(() => setCopiedId((c: string | null) => (c === id ? null : c)), 1500);
    } catch {
      /* clipboard permissions can silently fail */
    }
  }

  function toggleReaction(messageId: string, emoji: string) {
    setReactions((prev) => {
      const next = new Map(prev);
      const msgReactions = next.get(messageId) || [];
      const existing = msgReactions.find((r) => r.emoji === emoji);
      if (existing) {
        if (existing.reacted) {
          next.set(
            messageId,
            msgReactions.map((r) => r.emoji === emoji ? { ...r, count: r.count - 1, reacted: false } : r)
              .filter((r) => r.count > 0)
          );
        } else {
          next.set(
            messageId,
            msgReactions.map((r) => r.emoji === emoji ? { ...r, count: r.count + 1, reacted: true } : r)
          );
        }
      } else {
        next.set(messageId, [...msgReactions, { emoji, count: 1, reacted: true }]);
      }
      return next;
    });
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Mobile virtual keyboards fire an "Enter" keydown for their own
    // return/newline key (and mid-autocomplete keystrokes can trigger it
    // too), so treating Enter as "send" there causes half-typed messages to
    // fire unexpectedly and the keyboard to flicker open/closed. Only wire
    // Enter-to-send on devices with a real keyboard; touch devices send via
    // the on-screen Send button instead, and Enter just makes a new line.
    const isTouchDevice =
      typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
    if (e.key === "Enter" && !e.shiftKey && !isTouchDevice) {
      e.preventDefault();
      onSend(e as unknown as FormEvent<HTMLFormElement>);
      return;
    }
    if (e.key === "ArrowUp" && !input && !sendingRef.current && !editingId) {
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === "user") {
          e.preventDefault();
          startEdit(messages[i].id, messages[i].content);
          break;
        }
      }
    }
  }

  if (notFound) {
    return (
      <RequireAuth>
        <AppShell>
          <main className="flex-1 flex items-center justify-center gap-4">
            <p className="font-display text-xl">Couldn't find that character.</p>
            <Link href="/dashboard" className="text-gold hover:underline">
              Back to Studio
            </Link>
          </main>
        </AppShell>
      </RequireAuth>
    );
  }

  if (!character) {
    return (
      <RequireAuth>
        <AppShell variant="chat">
          <main className="flex-1 flex flex-col min-h-0 relative animate-pulse">
            <header className="flex items-center gap-3 px-6 py-4 border-b border-white/10">
              <div className="w-6 h-6 rounded bg-white/10" />
              <div className="w-9 h-9 rounded-full bg-white/10" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-24 rounded bg-white/10" />
                <div className="h-3 w-40 rounded bg-white/10" />
              </div>
            </header>
            <div className="flex-1 px-6 py-6 space-y-4">
              <div className="max-w-[85%] sm:max-w-lg h-16 rounded-2xl bg-surface-card" />
              <div className="max-w-xs h-10 ml-auto rounded-2xl bg-white/5" />
            </div>
          </main>
        </AppShell>
      </RequireAuth>
    );
  }

  return (
    <RequireAuth>
      <AppShell variant="chat">
        <main className="flex-1 flex flex-col min-h-0 relative">
          {/* Header */}
          <header className="px-3 sm:px-4 md:px-6 py-2 border-b border-white/10 shrink-0 bg-gradient-to-r from-surface-raised to-plum-deep/30">
            {character && (
              <div className="flex items-center justify-between gap-2">
                <button onClick={() => router.push("/explore")} className="text-parchment/60 hover:text-gold focus-ring rounded px-2 py-1 transition-colors shrink-0">
                  ←
                </button>

                <div className="flex items-center gap-2 min-w-0">
                  <div
                    className="relative w-8 h-8 sm:w-9 sm:h-9 shrink-0 rounded-full overflow-hidden cursor-pointer ring-1 ring-white/10"
                    style={{ backgroundColor: `${character.accentColor}30` }}
                    onClick={() => setExpandedAvatar(character.avatarUrl ?? null)}
                  >
                    {character.avatarUrl ? (
                      <img src={resolveMediaUrl(character.avatarUrl)} alt={character.name} className="w-full h-full object-cover" />
                    ) : (
                      <span className="absolute inset-0 flex items-center justify-center text-lg">{character.avatarEmoji}</span>
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="font-display text-base sm:text-lg truncate leading-tight">{character.name}</p>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] text-blue-400">✓</span>
                      <span className="text-[10px] text-parchment/40">Verified character</span>
                      <span className="text-parchment/20 text-[10px]">·</span>
                      <button
                        type="button"
                        onClick={() => setEnginePickerOpen(true)}
                        className="text-[10px] text-parchment/50 hover:text-gold transition-colors truncate"
                        title="Change roleplay engine"
                      >
                        {activeEngineEmoji(displayEngineId)} {activeEngineLabel(roleplayPrefs, displayEngineId)}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="relative chat-menu">
                  <button
                    type="button"
                    onClick={() => setChatMenuOpen((s) => !s)}
                    className="text-parchment/60 hover:text-parchment focus-ring rounded-lg px-2 py-1 transition-colors"
                    aria-label="Chat menu"
                    aria-expanded={chatMenuOpen}
                  >
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      {chatMenuOpen ? (
                        <>
                          <line x1="18" y1="6" x2="6" y2="18" />
                          <line x1="6" y1="6" x2="18" y2="18" />
                        </>
                      ) : (
                        <>
                          <line x1="4" y1="6" x2="20" y2="6" />
                          <line x1="4" y1="12" x2="20" y2="12" />
                          <line x1="4" y1="18" x2="20" y2="18" />
                        </>
                      )}
                    </svg>
                  </button>
                  {chatMenuOpen && (
                    <div className="absolute right-0 top-full mt-1 w-44 bg-plum-deep border border-parchment/15 rounded-xl shadow-xl py-1 z-50 animate-fade-in">
                      <div className="px-3 py-2">
                        <div className="flex items-center justify-between text-[10px] text-parchment/40 mb-1">
                          <span>Closeness</span>
                          <span>{relationshipLevel}%</span>
                        </div>
                        <div className="h-1 rounded-full bg-white/10 overflow-hidden">
                          <div className="h-full bg-gold rounded-full transition-all" style={{ width: `${relationshipLevel}%` }} />
                        </div>
                      </div>
                      <div className="border-t border-parchment/10 my-0.5" />
                      <button onClick={() => { setEnginePickerOpen(true); setChatMenuOpen(false); }} className="w-full text-left px-3 py-2 text-xs text-parchment/80 hover:bg-white/5 transition-colors">🎛 Roleplay engine</button>
                      <button onClick={() => { setMemoryOpen(true); setChatMenuOpen(false); }} className="w-full text-left px-3 py-2 text-xs text-parchment/80 hover:bg-white/5 transition-colors">🧠 Memory</button>
                      <button
                        onClick={() => { onResetConversation(); setChatMenuOpen(false); }}
                        disabled={resetting}
                        className="w-full text-left px-3 py-2 text-xs text-parchment/80 hover:bg-white/5 transition-colors disabled:opacity-50"
                      >
                        {resetting ? "Clearing…" : "🗑 Clear conversation"}
                      </button>
                      <button onClick={() => { exportChat(); setChatMenuOpen(false); }} className="w-full text-left px-3 py-2 text-xs text-parchment/80 hover:bg-white/5 transition-colors">📤 Export chat</button>
                      <Link href={`/characters/${character.id}/edit`} onClick={() => setChatMenuOpen(false)} className="block w-full text-left px-3 py-2 text-xs text-parchment/80 hover:bg-white/5 transition-colors">✏️ Edit character</Link>
                      <div className="border-t border-parchment/10 my-0.5" />
                      <div className="px-3 py-2">
                        <p className="text-[10px] text-parchment/40 mb-1">Theme</p>
                        <div className="flex gap-1">
                          {CHAT_THEMES.map((t) => (
                            <button key={t.id} onClick={() => setTheme(t.id)} className={`theme-toggle-btn w-7 h-7 text-xs ${theme === t.id ? "border-gold/40 text-gold" : ""}`} title={`${t.label} theme`}>{t.emoji}</button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </header>

          <RoleplayModelPicker
            open={enginePickerOpen}
            onClose={() => setEnginePickerOpen(false)}
            prefs={roleplayPrefs}
            engineId={displayEngineId}
            onApply={applyEnginePrefs}
            canSteerScene={messages.length > 0}
            onSteerScene={steerScene}
            steering={sending}
          />

          {/* Messages Area */}
          <div
            ref={scrollRef}
            onScroll={onScroll}
            className="flex-1 overflow-y-auto px-4 md:px-12 py-6 space-y-4 bg-cover bg-center bg-no-repeat"
            style={character?.backgroundUrl ? { backgroundImage: `url(${resolveMediaUrl(character.backgroundUrl)})` } : undefined}
          >
            {character && messages.length === 0 && (
              <div className="max-w-[85%] sm:max-w-lg chat-bubble-assistant rounded-2xl rounded-tl-sm px-4 py-3 message-slide-in">
                {character.greeting}
              </div>
            )}
            {messages.map((m: Message, i: number) => {
              const isLastAssistant = m.role === "assistant" && i === messages.length - 1;
              const isStreamingEmpty = isLastAssistant && sending && !m.content;
              const isEditing = editingId === m.id;
              const msgReactions = reactions.get(m.id) || [];

              const userInitial = (currentUser?.displayName || "You").charAt(0).toUpperCase();

              return (
                <div key={m.id} className="group message-slide-in flex gap-2 sm:gap-3">
                  {/* Avatar */}
                  {m.role === "assistant" ? (
                    <div
                      className="w-8 h-8 sm:w-9 sm:h-9 shrink-0 rounded-full overflow-hidden cursor-pointer ring-1 ring-white/10"
                      style={{ backgroundColor: `${character.accentColor}30` }}
                      onClick={() => setExpandedAvatar(character.avatarUrl ?? null)}
                    >
                      {character.avatarUrl ? (
                        <img src={resolveMediaUrl(character.avatarUrl)} alt={character.name} className="w-full h-full object-cover" />
                      ) : (
                        <span className="absolute inset-0 flex items-center justify-center text-lg">{character.avatarEmoji}</span>
                      )}
                    </div>
                  ) : (
                    <div className="w-8 h-8 sm:w-9 sm:h-9 shrink-0 rounded-full overflow-hidden bg-plum-deep/80 flex items-center justify-center text-xs font-semibold text-parchment/80">
                      {userInitial}
                    </div>
                  )}

                  {/* Content */}
                  <div className={`flex-1 min-w-0 flex flex-col ${m.role === "user" ? "items-end" : "items-start"}`}>
                    {/* Name + badge + time */}
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-sm text-parchment/90 truncate">
                        {m.role === "assistant" ? character.name : (currentUser?.displayName || "You")}
                      </span>
                      {m.role === "assistant" && (
                        <span className="text-[10px] text-blue-400 shrink-0">✓</span>
                      )}
                      {m.createdAt && (
                        <span className="text-[10px] text-parchment/30">{formatTime(m.createdAt)}</span>
                      )}
                    </div>

                    {/* Bubble */}
                    {isEditing ? (
                      <div className="max-w-[85%] sm:max-w-lg rounded-2xl bg-plum-deep/90 border border-gold/30 p-3 shadow-lg">
                        <textarea
                          ref={editTextareaRef}
                          autoFocus
                          value={editDraft}
                          onChange={(e) => {
                            setEditDraft(e.target.value);
                            autoResizeEdit();
                          }}
                          onKeyDown={(e: KeyboardEvent<HTMLTextAreaElement>) => {
                            if (e.key === "Enter" && !e.shiftKey) {
                              e.preventDefault();
                              submitEdit(m.id);
                            } else if (e.key === "Escape") {
                              cancelEdit();
                            }
                          }}
                          rows={2}
                          className="w-full bg-transparent resize-none focus:outline-none text-parchment placeholder:text-parchment/40"
                        />
                        <div className="flex justify-end gap-2 mt-2">
                          <button
                            onClick={cancelEdit}
                            className="text-xs text-ink/60 hover:text-ink px-3 py-1 rounded-full focus-ring"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={() => submitEdit(m.id)}
                            disabled={!editDraft.trim() || savingEdit}
                            className="text-xs bg-ink text-parchment px-3 py-1 rounded-full font-medium hover:brightness-125 focus-ring disabled:opacity-40"
                          >
                            {savingEdit ? "Saving…" : "Save & regenerate"}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div
                        aria-live={isLastAssistant ? "polite" : undefined}
                        className={`max-w-[85%] sm:max-w-lg px-4 py-3 rounded-2xl whitespace-pre-wrap break-words ${
                          m.role === "user"
                            ? "chat-bubble-user rounded-tr-sm"
                            : "chat-bubble-assistant rounded-tl-sm"
                        }`}
                      >
                        {isStreamingEmpty ? (
                          <div className="typing-indicator-enhanced">
                            <span className="text-xs text-parchment/60 mr-1">{character.name} is typing</span>
                            <span className="typing-indicator-dot" />
                            <span className="typing-indicator-dot" />
                            <span className="typing-indicator-dot" />
                          </div>
                        ) : (
                          renderMessageContent(m.content)
                        )}
                      </div>
                    )}

                    {/* Reactions */}
                    {m.content && !isEditing && (
                      <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                        {REACTION_EMOJIS.map((emoji) => {
                          const existing = msgReactions.find((r) => r.emoji === emoji);
                          return (
                            <button
                              key={emoji}
                              onClick={() => toggleReaction(m.id, emoji)}
                              className={`reaction-btn ${existing?.reacted ? "reacted" : ""}`}
                              aria-label={`React with ${emoji}${existing ? ` (${existing.count})` : ""}`}
                            >
                              {emoji}
                              {existing && existing.count > 0 && <span className="text-[10px] font-medium">{existing.count}</span>}
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {/* Actions */}
                    {m.content && !isEditing && (
                      <div className="flex items-center gap-3 mt-1 text-xs text-parchment/40 opacity-0 group-hover:opacity-100 transition-opacity">
                        <div className="relative message-menu">
                          <button
                            onClick={() => toggleMenu(m.id)}
                            className="hover:text-gold focus-ring rounded px-1"
                            aria-label="Message options"
                          >
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                              <circle cx="8" cy="3" r="1.5" />
                              <circle cx="8" cy="8" r="1.5" />
                              <circle cx="8" cy="13" r="1.5" />
                            </svg>
                          </button>
                          {openMenuId === m.id && (
                            <div
                              className={`absolute ${m.role === "user" ? "right-0" : "left-0"} bottom-full mb-1 min-w-[140px] rounded-xl bg-plum-deep border border-parchment/15 shadow-xl py-1 z-50 overflow-hidden`}
                            >
                              <button
                                onClick={() => { onCopy(m.id, m.content); setOpenMenuId(null); }}
                                className="w-full text-left px-3 py-1.5 hover:bg-white/5 text-parchment/80 hover:text-gold transition-colors text-xs"
                              >
                                {copiedId === m.id ? "Copied" : "Copy"}
                              </button>
                              {m.role === "assistant" && (
                                <button
                                  onClick={() => { onSpeak(m.id, m.content); setOpenMenuId(null); }}
                                  disabled={loadingAudioId === m.id}
                                  className="w-full text-left px-3 py-1.5 hover:bg-white/5 text-parchment/80 hover:text-gold transition-colors disabled:opacity-50 text-xs"
                                >
                                  {loadingAudioId === m.id ? "Loading…" : playingId === m.id ? "⏸ Pause" : "🔊 Play"}
                                </button>
                              )}
                              {m.role === "user" && !sendingRef.current && (
                                <button
                                  onClick={() => { startEdit(m.id, m.content); setOpenMenuId(null); }}
                                  className="w-full text-left px-3 py-1.5 hover:bg-white/5 text-parchment/80 hover:text-gold transition-colors text-xs"
                                >
                                  Edit
                                </button>
                              )}
                              {isLastAssistant && !sendingRef.current && (
                                <button
                                  onClick={() => { onRegenerate(); setOpenMenuId(null); }}
                                  className="w-full text-left px-3 py-1.5 hover:bg-white/5 text-parchment/80 hover:text-gold transition-colors text-xs"
                                >
                                  Regenerate
                                </button>
                              )}
                              <div className="border-t border-parchment/10 my-0.5" />
                              <button
                                onClick={() => { confirmDelete(m.id); setOpenMenuId(null); }}
                                className="w-full text-left px-3 py-1.5 hover:bg-white/5 text-rose hover:text-rose transition-colors text-xs"
                              >
                                Delete
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            <div ref={bottomRef} />
          </div>

          {/* Quick Actions Bar */}
          {showQuickActions && (
            <div ref={quickActionsRef} className="px-4 md:px-12 pb-2">
              <div className="quick-actions-bar max-w-3xl mx-auto">
                <button
                  onClick={() => setShowQuickActions(false)}
                  className="quick-action-btn"
                  title="Close quick actions"
                >
                  ✕
                </button>
                <div className="w-px h-5 bg-parchment/10" />
                <button
                  onClick={onRegenerate}
                  disabled={sending || messages.length === 0}
                  className="quick-action-btn"
                  title="Regenerate last reply"
                >
                  🔄
                </button>
                <button
                  onClick={() => {
                    const last = messages[messages.length - 1];
                    if (last?.content) onCopy(last.id, last.content);
                  }}
                  disabled={messages.length === 0}
                  className="quick-action-btn"
                  title="Copy last message"
                >
                  📋
                </button>
                <button
                  onClick={() => {
                    const last = messages[messages.length - 1];
                    if (last?.content && last.role === "assistant") onSpeak(last.id, last.content);
                  }}
                  disabled={messages.length === 0}
                  className="quick-action-btn"
                  title="Speak last message"
                >
                  🔊
                </button>
                <button
                  onClick={() => {
                    if (messages.length > 0) {
                      const last = messages[messages.length - 1];
                      if (last?.role === "assistant") toggleReaction(last.id, "❤️");
                    }
                  }}
                  disabled={messages.length === 0}
                  className="quick-action-btn"
                  title="Quick react"
                >
                  ❤️
                </button>
              </div>
            </div>
          )}

          <ConfirmDialog
            open={resetConfirmOpen}
            title={`Clear this conversation with ${character?.name ?? "this character"}?`}
            description="This deletes every message in this chat. This can't be undone."
            confirmLabel="Clear"
            destructive
            onConfirm={confirmResetConversation}
            onCancel={() => setResetConfirmOpen(false)}
          />

          <ConfirmDialog
            open={deleteConfirmOpen}
            title="Delete this message?"
            description="This can't be undone."
            confirmLabel="Delete"
            destructive
            onConfirm={onDeleteMessage}
            onCancel={() => { setDeleteConfirmOpen(false); setDeleteTargetId(null); }}
          />

          {character && (
            <AvatarGenerateModal
              open={avatarModalOpen}
              characterId={character.id}
              characterName={character.name}
              isExplicit={character.isExplicit}
              currentAvatarUrl={character.avatarUrl}
              onClose={() => setAvatarModalOpen(false)}
              onUpdated={(avatarUrl) => setCharacter((c) => (c ? { ...c, avatarUrl } : c))}
            />
          )}

          {character && (
            <MemoryPanel
              open={memoryOpen}
              characterId={character.id}
              characterName={character.name}
              onClose={() => setMemoryOpen(false)}
            />
          )}

          {expandedAvatar && (
            <div
              className="fixed inset-0 z-[60] bg-black/90 flex items-center justify-center p-4 animate-fade-in"
              onClick={() => setExpandedAvatar(null)}
            >
              <button
                type="button"
                onClick={() => setExpandedAvatar(null)}
                className="absolute top-4 right-4 text-parchment/60 hover:text-parchment focus-ring rounded-full p-2 transition-colors"
                aria-label="Close expanded avatar"
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
              <div className="max-w-sm max-h-[80vh] rounded-2xl overflow-hidden shadow-2xl" onClick={(e) => e.stopPropagation()}>
                {character.avatarUrl ? (
                  <img src={resolveMediaUrl(character.avatarUrl)} alt={character.name} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-64 h-64 flex items-center justify-center text-8xl" style={{ backgroundColor: `${character.accentColor}30` }}>
                    {character.avatarEmoji}
                  </div>
                )}
              </div>
            </div>
          )}

          <audio ref={audioElRef} onEnded={() => setPlayingId(null)} className="hidden" />

          {voiceError && (
            <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-rose/90 text-ink text-sm px-4 py-2 rounded-full shadow-lg toast-in z-50">
              {voiceError}
              <button onClick={() => setVoiceError("")} className="ml-3 underline">
                Dismiss
              </button>
            </div>
          )}
          {showJump && (
            <button
              onClick={() => scrollToBottom()}
              className="scroll-jump-btn"
            >
              ↓ Jump to latest
            </button>
          )}

          {toast && (
            <div
              role="status"
              className="toast-in absolute bottom-24 left-1/2 -translate-x-1/2 bg-plum-deep border border-gold/40 text-sm px-4 py-2 rounded-full shadow-lg max-w-sm text-center z-50"
            >
              {toast}
            </div>
          )}

          {error && (
            <div className="px-4 sm:px-6 py-2 flex items-center gap-3 text-sm">
              <p className="text-rose">{error}</p>
              {lastActionRef.current && (
                <button
                  onClick={onRetry}
                  disabled={sendingRef.current}
                  className="text-parchment/70 hover:text-gold focus-ring rounded px-2 py-0.5 border border-parchment/20 hover:border-gold/50 disabled:opacity-40 shrink-0"
                >
                  Retry
                </button>
              )}
            </div>
          )}

          <form onSubmit={onSend} className="flex gap-2 px-4 sm:px-6 py-3 sm:py-4 border-t border-parchment/10 items-end shrink-0">
            <div className="flex-1 relative">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value.slice(0, MAX_MESSAGE_LENGTH));
                  autoResize();
                }}
                onKeyDown={onKeyDown}
                placeholder="Message..."
                rows={1}
                className="w-full rounded-2xl bg-plum-deep/80 border border-parchment/15 px-4 py-2.5 text-sm focus-ring resize-none max-h-40 overflow-y-auto"
              />
            </div>
            <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setShowQuickActions((s) => !s)}
                className="text-parchment/50 hover:text-parchment/80 focus-ring rounded px-2 py-2.5 transition-colors"
                title="Quick actions"
                aria-label="Toggle quick actions"
              >
                ⚡
              </button>
              {sending ? (
                <button
                  type="button"
                  onClick={stopGenerating}
                  className="bg-rose/90 text-ink px-4 py-2.5 rounded-full text-sm font-medium hover:brightness-110 focus-ring shrink-0"
                >
                  ■ Stop
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!input.trim()}
                  className="bg-gold text-ink px-4 py-2.5 rounded-full text-sm font-medium hover:brightness-110 focus-ring disabled:opacity-50 shrink-0"
                >
                  Send
                </button>
              )}
            </div>
          </form>
        </main>
      </AppShell>
    </RequireAuth>
  );
}