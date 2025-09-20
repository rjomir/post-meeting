import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export async function fetchWithRetry(input: RequestInfo | URL, init?: RequestInit, attempts = 2, timeoutMs = 8000): Promise<Response> {
  for (let i = 0; i <= attempts; i++) {
    try {
      const timeout = new Promise<Response>((resolve) =>
        setTimeout(() => resolve(new Response(new Blob(["Request timed out"]), { status: 599, statusText: "Network Timeout" })), timeoutMs)
      );
      const res = await Promise.race([
        fetch(input, { cache: "no-store", credentials: "same-origin", ...init }),
        timeout,
      ]);
      if (res.status === 599 && i < attempts) continue;
      return res;
    } catch (e: any) {
      if (i === attempts) {
        const blob = new Blob([(e?.message || "Network error")], { type: "text/plain" });
        return new Response(blob, { status: 599, statusText: "Network Error" });
      }
    }
  }
  return new Response(new Blob(["Unknown error"]), { status: 599, statusText: "Network Error" });
}
