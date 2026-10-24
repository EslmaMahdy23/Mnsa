export function safeAuthReturn(path: string | null | undefined): string {
  if (path && /^\/dashboard\/courses\/[a-zA-Z0-9-]+$/.test(path)) return path;
  return "/dashboard";
}

export function readAuthReturn(): string {
  if (typeof window === "undefined") return "/dashboard";
  return safeAuthReturn(new URLSearchParams(window.location.search).get("next"));
}
