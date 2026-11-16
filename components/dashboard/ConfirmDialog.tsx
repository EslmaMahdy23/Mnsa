"use client";

import { useEffect, useId, useRef } from "react";
import { LoadingButton } from "@/components/dashboard/LoadingState";
import "./ConfirmDialog.css";

type Props = {
  open: boolean;
  title: string;
  icon?: string; // اسم أيقونة Font Awesome، مثال: "fa-paper-plane"
  tone?: "primary" | "warn" | "success";
  confirmLabel: string;
  cancelLabel?: string;
  busy?: boolean;
  busyLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  children?: React.ReactNode;
};

// نافذة تأكيد منبثقة موحّدة (تسليم الامتحان، الاشتراك في كورس...).
// Esc أو الضغط برا النافذة بيقفلها، إلا وقت التنفيذ (busy).
export default function ConfirmDialog({
  open, title, icon = "fa-circle-question", tone = "primary", confirmLabel, cancelLabel = "رجوع",
  busy = false, busyLabel = "جاري التنفيذ", onConfirm, onCancel, children,
}: Props) {
  const titleId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancelRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy]);

  // الفوكس على "رجوع" مرة واحدة لما النافذة تفتح، عشان الضغط على Enter بالغلط ما يأكدش العملية
  useEffect(() => {
    if (open) cancelRef.current?.focus();
  }, [open]);

  if (!open) return null;

  return (
    <div className="cd-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onCancel(); }}>
      <div className={`cd-box ${tone}`} role="alertdialog" aria-modal="true" aria-labelledby={titleId} dir="rtl">
        <span className="cd-icon"><i className={`fa-solid ${icon}`} aria-hidden="true" /></span>
        <h2 id={titleId}>{title}</h2>
        <div className="cd-body">{children}</div>
        <div className="cd-actions">
          <button type="button" className="btn btn-outline" ref={cancelRef} onClick={onCancel} disabled={busy}>{cancelLabel}</button>
          <button type="button" className="btn" onClick={onConfirm} disabled={busy}>
            {busy ? <LoadingButton>{busyLabel}</LoadingButton> : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
