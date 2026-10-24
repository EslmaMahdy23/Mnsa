"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useProfile } from "@/components/dashboard/ProfileContext";

type Notification = {
  id: string;
  source_type: "course" | "exam" | "lecture_schedule" | "admin_broadcast" | "forum_answer" | "exam_essay_review";
  title: string;
  message: string;
  href: string;
  created_at: string;
  read_at: string | null;
};

const iconFor = (type: Notification["source_type"]) =>
  type === "course" ? "fa-book-open" : type === "exam" || type === "exam_essay_review" ? "fa-file-circle-check" : type === "lecture_schedule" ? "fa-calendar-days" : type === "forum_answer" ? "fa-comments" : "fa-bullhorn";

const relativeDate = (value: string) => {
  const elapsed = Math.max(0, Date.now() - new Date(value).getTime());
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "دلوقتي";
  if (minutes < 60) return `من ${minutes.toLocaleString("ar-EG")} دقيقة`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `من ${hours.toLocaleString("ar-EG")} ساعة`;
  const days = Math.floor(hours / 24);
  return days < 7 ? `من ${days.toLocaleString("ar-EG")} يوم` : new Intl.DateTimeFormat("ar-EG", { dateStyle: "medium" }).format(new Date(value));
};

export default function StudentNotifications() {
  const profile = useProfile();
  const pathname = usePathname();
  const rootRef = useRef<HTMLDivElement>(null);
  const knownIdsRef = useRef(new Set<string>());
  const initializedRef = useRef(false);
  const [rows, setRows] = useState<Notification[]>([]);
  const [floatingRows, setFloatingRows] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const unread = useMemo(() => rows.filter((row) => !row.read_at).length, [rows]);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    const { data, error: err } = await supabase
      .from("student_notifications")
      .select("id, source_type, title, message, href, created_at, read_at")
      .eq("user_id", profile.id)
      .order("created_at", { ascending: false })
      .limit(30);
    if (err) {
      console.error("student notifications load failed:", err);
      setError("مقدرناش نحمّل الإشعارات.");
    } else {
      setError("");
      const nextRows = (data ?? []) as Notification[];
      if (initializedRef.current) {
        const fresh = nextRows.filter((row) => !knownIdsRef.current.has(row.id));
        fresh.forEach((row) => knownIdsRef.current.add(row.id));
        if (fresh.length) {
          setFloatingRows((current) => [...fresh, ...current].slice(0, 3));
          fresh.forEach((row) => window.setTimeout(() => {
            setFloatingRows((current) => current.filter((item) => item.id !== row.id));
          }, 7000));
        }
      } else {
        nextRows.forEach((row) => knownIdsRef.current.add(row.id));
        initializedRef.current = true;
      }
      setRows(nextRows);
    }
    setLoading(false);
  }, [profile.id]);

  useEffect(() => {
    if (profile.role !== "student") return;
    load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") load(true);
    }, 12_000);
    const channel = supabase
      .channel(`student-notifications-${profile.id}`)
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "student_notifications",
        filter: `user_id=eq.${profile.id}`,
      }, (payload) => {
        const row = payload.new as Notification;
        if (!row?.id || knownIdsRef.current.has(row.id)) return;
        knownIdsRef.current.add(row.id);
        setRows((current) => [row, ...current.filter((item) => item.id !== row.id)].slice(0, 30));
        setFloatingRows((current) => [row, ...current].slice(0, 3));
        window.setTimeout(() => {
          setFloatingRows((current) => current.filter((item) => item.id !== row.id));
        }, 7000);
      })
      .subscribe();
    return () => {
      window.clearInterval(timer);
      void supabase.removeChannel(channel);
    };
  }, [load, profile.role]);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const closeOnOutside = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutside);
    return () => document.removeEventListener("mousedown", closeOnOutside);
  }, [open]);

  if (profile.role !== "student") return null;

  async function markRead(row: Notification) {
    if (row.read_at) return;
    const readAt = new Date().toISOString();
    setRows((current) => current.map((item) => item.id === row.id ? { ...item, read_at: readAt } : item));
    const { error: err } = await supabase.from("student_notifications").update({ read_at: readAt }).eq("id", row.id).eq("user_id", profile.id);
    if (err) {
      console.error("notification mark read failed:", err);
      load(true);
    }
  }

  async function markAllRead() {
    if (!unread || busy) return;
    setBusy(true);
    setError("");
    const readAt = new Date().toISOString();
    const { error: err } = await supabase.from("student_notifications").update({ read_at: readAt }).eq("user_id", profile.id).is("read_at", null);
    setBusy(false);
    if (err) {
      console.error("mark all notifications read failed:", err);
      setError("مقدرناش نحدّث الإشعارات. جرّب تاني.");
    } else setRows((current) => current.map((row) => row.read_at ? row : { ...row, read_at: readAt }));
  }

  async function deleteNotification(row: Notification) {
    if (deletingId) return;
    setDeletingId(row.id);
    setError("");
    setRows((current) => current.filter((item) => item.id !== row.id));
    const { error: err } = await supabase
      .from("student_notifications")
      .delete()
      .eq("id", row.id)
      .eq("user_id", profile.id);
    setDeletingId(null);
    if (err) {
      console.error("notification delete failed:", err);
      setError("مقدرناش نحذف الإشعار. جرّب تاني.");
      load(true);
    }
  }

  return (
    <div className="student-notifications" ref={rootRef}>
      {floatingRows.length > 0 && <div className="student-notification-toasts" aria-live="polite">
        {floatingRows.map((row) => <article className="student-notification-toast" key={row.id} role="status">
          <Link href={row.href} className="student-notification-toast-link" onClick={() => markRead(row)}>
            <span className={`notification-icon notification-icon-${row.source_type}`}><i className={`fa-solid ${iconFor(row.source_type)}`} /></span>
            <span className="student-notification-toast-copy"><b>{row.title}</b><span>{row.message}</span></span>
          </Link>
          <button type="button" className="student-notification-toast-close" aria-label="إغلاق الإشعار" onClick={() => setFloatingRows((current) => current.filter((item) => item.id !== row.id))}><i className="fa-solid fa-xmark" /></button>
        </article>)}
      </div>}
      <button type="button" className={`notifications-trigger${open ? " is-open" : ""}`} aria-label={`الإشعارات${unread ? `، ${unread} غير مقروء` : ""}`} aria-expanded={open} onClick={() => { setOpen((value) => !value); if (!open) load(true); }}>
        <i className="fa-regular fa-bell" />
        {unread > 0 && <span className="notifications-count">{unread > 9 ? "٩+" : unread.toLocaleString("ar-EG")}</span>}
      </button>
      {open && <section className="notifications-popover" aria-label="الإشعارات">
        <header className="notifications-head"><div><b>إشعاراتك</b><span>{unread ? `${unread.toLocaleString("ar-EG")} غير مقروءة` : "كلها مقروءة"}</span></div><button type="button" disabled={!unread || busy} onClick={markAllRead}>{busy ? "جاري التحديث..." : "تحديد الكل كمقروء"}</button></header>
        {error && <p className="notifications-error">{error}</p>}
        <div className="notifications-list">
          {loading && rows.length === 0 ? <p className="notifications-empty">بنحمّل إشعاراتك...</p> : rows.length === 0 ? <div className="notifications-empty"><i className="fa-regular fa-bell-slash" /><b>مفيش إشعارات جديدة</b><span>هنبلغك لما ينزل كورس أو امتحان أو جدول جديد.</span></div> : rows.map((row) => <div key={row.id} className={`notification-item${row.read_at ? " is-read" : " is-unread"}`}>
            <Link href={row.href} className="notification-item-link" onClick={() => { markRead(row); setOpen(false); }}>
              <span className={`notification-icon notification-icon-${row.source_type}`}><i className={`fa-solid ${iconFor(row.source_type)}`} /></span>
              <span className="notification-copy"><b>{row.title}</b><span>{row.message}</span><small>{relativeDate(row.created_at)}</small></span>
              {!row.read_at && <span className="notification-unread-dot" aria-label="غير مقروء" />}
            </Link>
            <button type="button" className="notification-delete" aria-label={`حذف إشعار: ${row.title}`} title="حذف الإشعار" disabled={deletingId !== null} onClick={() => deleteNotification(row)}>
              <i className={`fa-solid ${deletingId === row.id ? "fa-spinner fa-spin" : "fa-trash-can"}`} />
            </button>
          </div>)}
        </div>
      </section>}
    </div>
  );
}
