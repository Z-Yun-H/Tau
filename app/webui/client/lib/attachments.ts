/**
 * Image-attachment helpers for the composer (image parsing module, issue
 * #135). Pure functions over duck-typed `File` objects so tests can inject
 * minimal stubs without a DOM. The browser owns the reading (File API);
 * the server re-validates everything (media-type whitelist, size caps,
 * magic-number probe) — these checks exist to fail FAST and READABLY in
 * the UI, not to be the security boundary.
 */

/** One image draft in the composer, ready to send. */
export interface AttachmentDraft {
  /** Original file name when the browser knows one (display-only). */
  name?: string;
  /** Claimed media type, e.g. "image/png" — whitelisted below. */
  mediaType: string;
  /** Decoded byte size. */
  bytes: number;
  /** Raw base64 payload (no data: prefix) — exactly the server's shape. */
  dataBase64: string;
  /** Runtime preview URL (`data:` URL) — never sent to the server. */
  dataUrl: string;
}

/** What a user card keeps per attachment (persisted state). */
export interface AttachmentMeta {
  name?: string;
  mediaType: string;
  bytes: number;
  /**
   * Runtime preview (data: URL). Stripped on persist — localStorage quota
   * cannot hold image payloads; after a reload the chip degrades to a
   * name + type label, honestly.
   */
  thumb?: string;
}

/** Max images per request (server enforces the same cap). */
export const MAX_ATTACHMENTS = 4;
/** Max decoded size per image (server allows ~4.2 MB base64 — stay under). */
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
/** Accepted image media types (mirrors the server whitelist exactly). */
export const ACCEPTED_IMAGE_TYPES: readonly string[] = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
];
/** `accept` attribute for the file picker — the same whitelist, as extensions. */
export const FILE_ACCEPT_ATTR =
  ".png,.jpg,.jpeg,.webp,.gif,image/png,image/jpeg,image/webp,image/gif";

/** Media type guessed from a file extension (browsers may send an empty type). */
const EXT_MEDIA_TYPE: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

/**
 * Base64 over arbitrary bytes in 0x8000-byte chunks (btoa has no typed-
 * array overload and call-stack limits punish one-shot conversions).
 * Available in every browser target and Node ≥ 16 (global btoa).
 */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Human byte size for chips and error messages ("1.2 MB", "380 KB"). */
export function describeBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

/**
 * Minimal structural shape of a browser `File` this module needs — tests
 * inject plain objects, the composer passes real Files.
 */
export interface FileLike {
  name?: string;
  type: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/** Resolve the effective media type: the browser's type, else the extension. */
function effectiveType(file: FileLike): string {
  if (ACCEPTED_IMAGE_TYPES.includes(file.type)) return file.type;
  const ext = (file.name ?? "").split(".").pop()?.toLowerCase() ?? "";
  return EXT_MEDIA_TYPE[ext] ?? file.type;
}

/**
 * Convert picked/pasted/dropped files into composer drafts. All-or-nothing
 * per batch: the first invalid file aborts the whole batch with a readable
 * error (partial adds after a failure would surprise). Respects the
 * combined cap via `existingCount` (what the composer already holds).
 */
export async function filesToDrafts(
  files: ArrayLike<FileLike>,
  existingCount = 0,
): Promise<{ drafts: AttachmentDraft[]; error?: string }> {
  const list = Array.from(files);
  if (list.length === 0) return { drafts: [] };
  if (existingCount + list.length > MAX_ATTACHMENTS) {
    return {
      drafts: [],
      error: `up to ${MAX_ATTACHMENTS} images per message`,
    };
  }
  const drafts: AttachmentDraft[] = [];
  for (const file of list) {
    const mediaType = effectiveType(file);
    if (!ACCEPTED_IMAGE_TYPES.includes(mediaType)) {
      return {
        drafts: [],
        error: `"${file.name || "pasted image"}": unsupported type — use PNG, JPEG, WebP or GIF`,
      };
    }
    if (file.size > MAX_IMAGE_BYTES) {
      return {
        drafts: [],
        error: `"${file.name || "pasted image"}" is ${describeBytes(file.size)} — max ${describeBytes(MAX_IMAGE_BYTES)}`,
      };
    }
    if (file.size === 0) {
      return { drafts: [], error: `"${file.name || "pasted image"}" is empty` };
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const dataBase64 = bytesToBase64(bytes);
    drafts.push({
      ...(file.name ? { name: file.name } : {}),
      mediaType,
      bytes: file.size,
      dataBase64,
      dataUrl: `data:${mediaType};base64,${dataBase64}`,
    });
  }
  return { drafts };
}

/** Wire payload for one draft (the exact shape the server validates). */
export function draftToPayload(draft: AttachmentDraft): {
  kind: "image";
  name?: string;
  mediaType: string;
  dataBase64: string;
} {
  return {
    kind: "image",
    ...(draft.name ? { name: draft.name } : {}),
    mediaType: draft.mediaType,
    dataBase64: draft.dataBase64,
  };
}

/** Persistable meta for one draft (drops the payload, keeps the preview). */
export function draftToMeta(draft: AttachmentDraft): AttachmentMeta {
  return {
    ...(draft.name ? { name: draft.name } : {}),
    mediaType: draft.mediaType,
    bytes: draft.bytes,
    thumb: draft.dataUrl,
  };
}
