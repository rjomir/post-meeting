import { Platform } from "@/lib/types";

export function PlatformIcon({ platform, className = "w-5 h-5" }: { platform: Platform; className?: string }) {
  if (platform === "zoom")
    return (
      <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
        <rect rx="6" ry="6" width="24" height="24" fill="#0B5CFF" />
        <rect x="5" y="8" width="9" height="6" rx="3" fill="white" />
        <path d="M15 9l4 2.5-4 2.5V9z" fill="white" />
      </svg>
    );
  if (platform === "teams")
    return (
      <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
        <rect rx="6" ry="6" width="24" height="24" fill="#5B4BDA" />
        <text x="6" y="16" fontSize="10" fill="white" fontFamily="Inter, system-ui">T</text>
      </svg>
    );
  if (platform === "meet")
    return (
      <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
        <rect rx="6" ry="6" width="24" height="24" fill="#00A884" />
        <path d="M7 8h6v8H7z" fill="white" />
        <path d="M13 10l4-2v8l-4-2z" fill="white" />
      </svg>
    );
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <rect rx="6" ry="6" width="24" height="24" fill="#64748B" />
      <circle cx="12" cy="12" r="3" fill="white" />
    </svg>
  );
}
