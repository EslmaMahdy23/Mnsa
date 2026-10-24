import type { ReactNode } from "react";

export default function LoadingState({
  label = "جاري التحميل",
  detail = "بنجهّز المحتوى عشان يظهر لك",
  compact = false,
}: {
  label?: string;
  detail?: string;
  compact?: boolean;
}) {
  return (
    <div className={`student-loading${compact ? " compact" : ""}`} role="status" aria-live="polite">
      <span className="student-loading-mark"><i className="fa-solid fa-book-open" /><span /></span>
      <span className="student-loading-copy"><strong>{label}</strong>{!compact && <small>{detail}</small>}</span>
      <span className="student-loading-track"><i /></span>
    </div>
  );
}

export function LoadingButton({ children = "جاري التنفيذ", className = "" }: { children?: ReactNode; className?: string }) {
  return <span className={`student-loading-button ${className}`}><span className="student-loading-button-spinner" />{children}</span>;
}
