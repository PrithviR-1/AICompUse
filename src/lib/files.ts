// Turns picked, dropped or pasted files into attachments: images as data URLs, text files
// inlined; everything else is rejected with a plain reason (§11.5 attachments).
import type { NewAttachment } from "./bindings";

const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const TEXT_EXTENSIONS = /\.(txt|md|markdown|csv|tsv|json|ya?ml|toml|xml|html?|css|scss|js|jsx|ts|tsx|mjs|cjs|py|rb|go|rs|java|kt|swift|c|h|cc|cpp|hpp|cs|php|sh|bash|zsh|sql|ini|cfg|conf|log|env\.example)$/i;
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

type FileResult = { ok: true; attachment: NewAttachment } | { ok: false; reason: string };

function readAs(file: File, mode: "dataUrl" | "text"): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    if (mode === "dataUrl") reader.readAsDataURL(file);
    else reader.readAsText(file);
  });
}

export async function fileToAttachment(file: File): Promise<FileResult> {
  const name = file.name || "pasted-image.png";
  if (file.size > MAX_ATTACHMENT_BYTES) return { ok: false, reason: `${name} is larger than 20 MB.` };
  if (IMAGE_TYPES.includes(file.type)) {
    const data = await readAs(file, "dataUrl");
    return { ok: true, attachment: { kind: "image", name, mime: file.type, size: file.size, data } };
  }
  if (file.type.startsWith("text/") || TEXT_EXTENSIONS.test(name) || file.type === "application/json") {
    const data = await readAs(file, "text");
    return { ok: true, attachment: { kind: "text", name, mime: file.type || "text/plain", size: file.size, data } };
  }
  return { ok: false, reason: `${name} isn't supported. Attach images or text files.` };
}
