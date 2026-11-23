"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import LoadingState from "@/components/dashboard/LoadingState";
import "./admin-notifications.css";

type Setting = { source_type: string; label: string; description: string; enabled: boolean };
type Recent = { source_type: string; source_id: string; title: string; message: string; href: string; last_sent_at: string; recipients: number };
type Center = { settings: Setting[]; recent: Recent[] };

const ICONS: Record<string, string> = {
  course: "fa-book-open", lesson: "fa-play", exam: "fa-file-circle-question", exam_result: "fa-square-poll-vertical",
  exam_essay_review: "fa-marker", lecture_schedule: "fa-calendar-days", live_session: "fa-video",
  subscription: "fa-graduation-cap", wallet_topup: "fa-wallet", certificate: "fa-award",
  forum_answer: "fa-comments", admin_broadcast: "fa-bullhorn",
};

const formatDate = (value: string) => new Intl.DateTimeFormat("ar-EG-u-nu-latn", {
  dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Cairo",
}).format(new Date(value));

export default function AdminNotificationControls() {
  const [center, setCenter] = useState<Center | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error: rpcError } = await supabase.rpc("admin_get_student_notification_center");
    setLoading(false);
    if (rpcError) {
      console.error("admin notification center load failed:", rpcError);
      setError("شغّل ملف 82_admin_notification_controls.sql في Supabase ثم حدّث الصفحة.");
      return;
    }
    setError("");
    setCenter(data as Center);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const toggle = async (setting: Setting) => {
    setBusy(setting.source_type);
    const { error: rpcError } = await supabase.rpc("admin_set_student_notification_setting", {
      p_source_type: setting.source_type,
      p_enabled: !setting.enabled,
    });
    setBusy(null);
    if (rpcError) {
      console.error("admin notification setting update failed:", rpcError);
      setError("تعذر حفظ الاختيار. حدّث الصفحة وحاول مرة تانية.");
      return;
    }
    setCenter((current) => current ? {
      ...current,
      settings: current.settings.map((item) => item.source_type === setting.source_type ? { ...item, enabled: !item.enabled } : item),
    } : current);
  };

  return (
    <section className="notification-control card" aria-labelledby="notification-control-title">
      <header className="notification-control-head">
        <span className="notification-control-mark"><i className="fa-solid fa-sliders" /></span>
        <div><small>تحكم الإدارة</small><h2 id="notification-control-title">إعدادات إشعارات الطلاب</h2><p>فعّل أنواع الإشعارات التي تريد إرسالها. أي نوع توقفه لن يصل للطلاب.</p></div>
        <button type="button" className="btn btn-outline btn-sm" onClick={() => void load()} disabled={loading}><i className="fa-solid fa-rotate" /> تحديث</button>
      </header>

      {error && <p className="notification-control-error" role="alert">{error}</p>}
      {loading ? <LoadingState label="بنحمّل إعدادات الإشعارات" detail="لحظة واحدة" compact /> : center && <>
        <div className="notification-setting-grid">
          {center.settings.map((setting) => (
            <article key={setting.source_type} className={`notification-setting-card${setting.enabled ? " is-enabled" : " is-disabled"}`}>
              <span className="notification-setting-icon"><i className={`fa-solid ${ICONS[setting.source_type] ?? "fa-bell"}`} /></span>
              <span className="notification-setting-copy"><b>{setting.label}</b><small>{setting.description}</small></span>
              <button type="button" role="switch" aria-checked={setting.enabled} aria-label={`${setting.enabled ? "إيقاف" : "تفعيل"} ${setting.label}`} className={`notification-switch${setting.enabled ? " on" : ""}`} disabled={busy !== null} onClick={() => void toggle(setting)}><span /></button>
            </article>
          ))}
        </div>

        <div className="notification-history">
          <div className="notification-history-heading"><div><h3>آخر الإشعارات المرسلة</h3><p>سجل الإرسال يعرض نوع الإشعار وعدد الطلاب الذين وصلهم.</p></div><b>{center.recent.length.toLocaleString("en-US")}</b></div>
          {center.recent.length === 0 ? <div className="notification-history-empty"><i className="fa-regular fa-bell-slash" /><span>لسه مفيش إشعارات مرسلة.</span></div> : (
            <div className="notification-history-list">
              {center.recent.map((item) => (
                <article className="notification-history-item" key={`${item.source_type}-${item.source_id}`}>
                  <span className="notification-history-icon"><i className={`fa-solid ${ICONS[item.source_type] ?? "fa-bell"}`} /></span>
                  <div className="notification-history-copy"><b>{item.title}</b><p>{item.message}</p><small>{formatDate(item.last_sent_at)}</small></div>
                  <span className="notification-history-count"><b>{item.recipients.toLocaleString("en-US")}</b><small>طالب</small></span>
                </article>
              ))}
            </div>
          )}
        </div>
      </>}
    </section>
  );
}
