// Copy to clipboard with a 1.5 s "Copied" confirmation (§15.6 message actions).
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "@/stores/toasts";

export function useCopy(): [boolean, (text: string) => Promise<void>] {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      toast("Couldn't copy to the clipboard.", { tone: "danger" });
    }
  }, []);
  return [copied, copy];
}
