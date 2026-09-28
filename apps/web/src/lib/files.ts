import { unzipSync } from "fflate";

/** A file ready to send to the server: always base64, so CSV, Excel and PDF travel the same way. */
export interface LoadedFile {
  id: string;
  name: string;
  size: number;
  content: string;
  encoding: "base64";
}

const JUNK = /(^|\/)(__MACOSX\/|\.DS_Store$|\._|Thumbs\.db$|desktop\.ini$)/i;
const MAX_BYTES = 15 * 1024 * 1024; // the server takes ~24 MB of base64 per request

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000; // stay under the argument limit of String.fromCharCode
  for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(binary);
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result ?? "");
      resolve(url.slice(url.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error("Couldn't read the file"));
    reader.readAsDataURL(file);
  });
}

export interface SkippedFile {
  name: string;
  why: string;
}

/** Read dropped files; ZIP archives are unpacked in the browser and their junk entries skipped. */
export async function loadFiles(files: File[]): Promise<{ loaded: LoadedFile[]; skipped: SkippedFile[] }> {
  const loaded: LoadedFile[] = [];
  const skipped: SkippedFile[] = [];
  for (const file of files) {
    if (JUNK.test(file.name)) continue;
    if (/\.zip$/i.test(file.name)) {
      try {
        const entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
        for (const [path, bytes] of Object.entries(entries)) {
          if (path.endsWith("/") || JUNK.test(path) || bytes.length === 0) continue;
          const name = path.split("/").pop() ?? path;
          if (bytes.length > MAX_BYTES) {
            skipped.push({ name, why: "too large (over 15 MB)" });
            continue;
          }
          loaded.push({ id: crypto.randomUUID(), name, size: bytes.length, content: bytesToBase64(bytes), encoding: "base64" });
        }
      } catch {
        skipped.push({ name: file.name, why: "the ZIP couldn't be opened" });
      }
      continue;
    }
    if (file.size > MAX_BYTES) {
      skipped.push({ name: file.name, why: "too large (over 15 MB)" });
      continue;
    }
    loaded.push({ id: crypto.randomUUID(), name: file.name, size: file.size, content: await fileToBase64(file), encoding: "base64" });
  }
  return { loaded, skipped };
}
