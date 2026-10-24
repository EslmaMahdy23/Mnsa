"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type StaffRole = "essay_grader" | "course_manager" | "forum_moderator" | "payment_manager" | "support_agent";
type Staff = { user_id: string; full_name: string | null; email: string; role: StaffRole; created_at: string };
const ROLE_LABELS: Record<StaffRole, string> = { essay_grader: "مصحح مقالي", course_manager: "مدير محتوى الكورسات", forum_moderator: "مسؤول المنتدى", payment_manager: "مسؤول طلبات الدفع", support_agent: "مسؤول الدعم" };
const ROLE_DESCRIPTIONS: Record<StaffRole, string> = {
  essay_grader: "يمكنه مراجعة إجابات المقال وتسجيل الدرجة والملاحظات فقط.",
  course_manager: "يمكنه إضافة وتعديل الكورسات والأقسام والدروس والامتحانات، دون إدارة الطلاب أو الحسابات.",
  forum_moderator: "يمكنه مراجعة أسئلة المنتدى ونشرها أو رفضها والرد على الطلاب.",
  payment_manager: "يمكنه مراجعة إثباتات الدفع وقبول أو رفض طلبات الشحن وتعديل المبلغ المقبول.",
  support_agent: "يمكنه متابعة تذاكر الدعم والرد على الطلاب وإغلاق التذاكر فقط.",
};

export default function StaffAccountsManager() {
  const [staff, setStaff] = useState<Staff[]>([]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<StaffRole>("essay_grader");
  const [staffQuery, setStaffQuery] = useState("");
  const [staffRoleFilter, setStaffRoleFilter] = useState<"all" | StaffRole>("all");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error: err } = await supabase.rpc("admin_list_staff");
    setLoading(false);
    if (err) return setError("تعذر تحميل حسابات الوكلاء. تأكد من تشغيل ملفات صلاحيات الوكلاء في Supabase.");
    setStaff((data ?? []) as Staff[]);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filteredStaff = staff.filter((row) => {
    const query = staffQuery.trim().toLocaleLowerCase("ar");
    const matchesQuery = !query || [row.full_name ?? "", row.email, ROLE_LABELS[row.role]]
      .some((value) => value.toLocaleLowerCase("ar").includes(query));
    return matchesQuery && (staffRoleFilter === "all" || row.role === staffRoleFilter);
  });

  async function createStaff(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) {
      setBusy(false);
      return setError("انتهت الجلسة. سجّل الدخول مرة أخرى.");
    }
    const response = await fetch("/api/admin/staff", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + session.access_token },
      body: JSON.stringify({ full_name: name, email, password, role }),
    });
    const result = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) return setError(result.error || "تعذر إنشاء الحساب.");
    setName("");
    setEmail("");
    setPassword("");
    setNotice("تم إنشاء حساب " + ROLE_LABELS[role] + " للبريد " + result.email + ". شارك بيانات الدخول معه بنفسك.");
    await load();
  }

  async function revoke(userId: string, staffName: string | null, staffRole: StaffRole) {
    const roleName = ROLE_LABELS[staffRole];
    if (!confirm("إلغاء صلاحية " + (staffName || roleName) + "؟ سيظل الحساب موجودًا كحساب طالب، ولن يستطيع استخدام أدوات هذا الدور.")) return;
    setBusy(true);
    setError("");
    const { error: err } = await supabase.rpc("admin_revoke_staff", { p_user: userId });
    setBusy(false);
    if (err) return setError("تعذر إلغاء الصلاحية.");
    setStaff((current) => current.filter((row) => row.user_id !== userId));
  }

  return <div className="staff-accounts-page">
    <section className="card">
      <h2>إنشاء حساب وكيل</h2>
      <p>أنشئ حسابًا بصلاحية محددة وشارك بيانات الدخول مع الوكيل بنفسك. كلمة السر لا تُعرض مرة أخرى بعد إنشاء الحساب.</p>
      <form className="staff-create-form" onSubmit={createStaff}>
        <label>اسم الوكيل<input required minLength={2} maxLength={100} value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label>البريد الإلكتروني<input required type="email" dir="ltr" autoComplete="off" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        <label>كلمة السر (١٢ حرفًا على الأقل)<input required type="password" minLength={12} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        <label className="staff-role-field">الدور<select value={role} onChange={(event) => setRole(event.target.value as StaffRole)}>{Object.entries(ROLE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><small className="staff-role-hint">{ROLE_DESCRIPTIONS[role]}</small></label>
        <button className="btn" disabled={busy}>{busy ? "جاري إنشاء الحساب..." : "إنشاء حساب الوكيل"}</button>
      </form>
      {error && <p className="msg-error">{error}</p>}
      {notice && <p className="msg-ok">{notice}</p>}
    </section>

    <section className="card">
      <h2>الوكلاء الحاليون</h2>
      {!loading && staff.length > 0 && <div className="staff-filters">
        <label className="staff-search"><i className="fa-solid fa-magnifying-glass" /><input type="search" value={staffQuery} onChange={(event) => setStaffQuery(event.target.value)} placeholder="ابحث بالاسم أو البريد أو الدور" aria-label="ابحث في حسابات الوكلاء" /></label>
        <label className="staff-role-filter"><span>تصفية بالدور</span><select value={staffRoleFilter} onChange={(event) => setStaffRoleFilter(event.target.value as "all" | StaffRole)}><option value="all">كل الأدوار</option>{Object.entries(ROLE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <small className="staff-results-count">{filteredStaff.length.toLocaleString("ar-EG")} من {staff.length.toLocaleString("ar-EG")} وكيل</small>
      </div>}
      {loading ? <p>جاري التحميل...</p> : staff.length === 0 ? <p>لا يوجد وكلاء مضافون حتى الآن.</p> : filteredStaff.length === 0 ? <p className="staff-no-results">مفيش وكلاء مطابقين للبحث أو الفلتر.</p> : <div className="staff-list">
        {filteredStaff.map((row) => <article key={row.user_id}>
          <div><b>{row.full_name || "وكيل"}</b><small>{row.email} · {ROLE_LABELS[row.role]} · {new Date(row.created_at).toLocaleDateString("ar-EG")}</small></div>
          <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => revoke(row.user_id, row.full_name, row.role)}>إلغاء الصلاحية</button>
        </article>)}
      </div>}
    </section>
  </div>;
}
