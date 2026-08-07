export type CharacterImportEntry = {
  name: string;
  tagline: string;
  personality: string;
  backstory: string;
  greeting: string;
  avatarEmoji: string;
  accentColor: string;
  isExplicit: boolean;
  isPublic: boolean;
  roleplayNotes?: string;
  examples?: string;
  tags?: string;
};

export type CharacterImportPreview = {
  valid: CharacterImportEntry[];
  errors: { index: number; name: string; error: string }[];
};

const MAX_FIELD_LENGTH = 1200;
const MAX_IMPORT_BATCH = 50;

function clean(value: unknown, fallback = ""): string {
  if (typeof value !== "string") return fallback;
  return value.trim().slice(0, MAX_FIELD_LENGTH);
}

/**
 * Pull a JSON value out of raw paste text — plain JSON, or JSON embedded in
 * a wrapper (e.g. a `.js`/`.ts` export file with the array/object surrounded
 * by other text). This is intentionally JSON-only: character files are
 * pasted or uploaded from other people (character cards get shared/traded
 * between users), so this must never evaluate the input as executable code
 * — a prior version used `new Function(...)` as a fallback for loose JS
 * object literals, which meant importing a file from someone else could run
 * arbitrary JavaScript in your own logged-in session. If a pasted file
 * isn't valid JSON, the fix is to ask for JSON, not to eval it.
 */
export function extractImportPayload(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("Paste JSON or upload a character file first.");
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    const arrayStart = trimmed.indexOf("[");
    const arrayEnd = trimmed.lastIndexOf("]");
    if (arrayStart !== -1 && arrayEnd > arrayStart) {
      const slice = trimmed.slice(arrayStart, arrayEnd + 1);
      try {
        return JSON.parse(slice);
      } catch {
        // fall through to the object-slice attempt / final error below
      }
    }

    const objectStart = trimmed.indexOf("{");
    const objectEnd = trimmed.lastIndexOf("}");
    if (objectStart !== -1 && objectEnd > objectStart) {
      const slice = trimmed.slice(objectStart, objectEnd + 1);
      try {
        return JSON.parse(slice);
      } catch {
        // fall through to the final error below
      }
    }

    throw new Error(
      "Couldn't parse that as JSON. Make sure keys and string values use double quotes " +
        "(e.g. \"name\": \"...\"), then use a JSON array or a file with a characters array."
    );
  }
}

/** Normalize common export shapes into a flat list of raw character objects. */
export function normalizeImportList(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;

  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    if (Array.isArray(obj.characters)) return obj.characters;
    if (typeof obj.name === "string") return [obj];
  }

  throw new Error("Expected a JSON array of characters, or an object with a characters array.");
}

export function parseCharacterEntry(body: unknown, index: number): { entry?: CharacterImportEntry; error?: string } {
  if (typeof body !== "object" || body === null) {
    return { error: `Row ${index + 1}: must be an object.` };
  }

  const raw = body as Record<string, unknown>;
  const name = clean(raw.name);
  const tagline = clean(raw.tagline);
  const personality = clean(raw.personality);
  const backstory = clean(raw.backstory);
  const greeting = clean(raw.greeting);
  const avatarEmoji = clean(raw.avatarEmoji, "🌸").slice(0, 8) || "🌸";
  const accentColor = /^#[0-9a-fA-F]{6}$/i.test(String(raw.accentColor ?? ""))
    ? String(raw.accentColor)
    : "#c9a227";
  const isExplicit = raw.isExplicit === true;
  const isPublic = raw.isPublic === true;
  const roleplayNotes = isExplicit ? clean(raw.roleplayNotes) : "";
  const examples = typeof raw.examples === "string" ? raw.examples : undefined;
  const tags = typeof raw.tags === "string" ? raw.tags : undefined;

  if (!name) return { error: `Row ${index + 1}: name is required.` };
  if (!personality) return { error: `Row ${index + 1} (${name}): personality is required.` };
  if (!backstory) return { error: `Row ${index + 1} (${name}): backstory is required.` };
  if (!greeting) return { error: `Row ${index + 1} (${name}): greeting is required.` };

  return {
    entry: {
      name,
      tagline,
      personality,
      backstory,
      greeting,
      avatarEmoji,
      accentColor,
      isExplicit,
      isPublic,
      roleplayNotes,
      ...(examples ? { examples } : {}),
      ...(tags ? { tags } : {}),
    },
  };
}

export function previewCharacterImport(text: string): CharacterImportPreview {
  const payload = extractImportPayload(text);
  const list = normalizeImportList(payload);

  if (list.length > MAX_IMPORT_BATCH) {
    throw new Error(`At most ${MAX_IMPORT_BATCH} characters per import (found ${list.length}).`);
  }

  const valid: CharacterImportEntry[] = [];
  const errors: CharacterImportPreview["errors"] = [];

  list.forEach((item, index) => {
    const parsed = parseCharacterEntry(item, index);
    if (parsed.entry) valid.push(parsed.entry);
    else errors.push({ index, name: clean((item as Record<string, unknown>)?.name), error: parsed.error ?? "Invalid entry." });
  });

  return { valid, errors };
}

export const IMPORT_FORMAT_EXAMPLE = `[
  {
    "name": "Example",
    "tagline": "a short hook",
    "personality": "trait one, trait two",
    "backstory": "2-4 sentences of history.",
    "greeting": "First line they say in chat.",
    "avatarEmoji": "🌸",
    "accentColor": "#c9a227",
    "isExplicit": false,
    "examples": "[{\\"user\\": \\"Hi\\", \\"character\\": \\"Hey there!\\"}]",
    "tags": "[\"fantasy\", \"romance\"]"
  }
]`;
