"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { adminErrorMessage, fmtDate } from "@/lib/admin";
import { useProfile, ROLE_LABEL } from "@/components/dashboard/ProfileContext";
import { GRADES } from "@/lib/validation";
import Pagination from "@/components/admin/Pagination";
import UserEditModal, { type AdminUser } from "@/components/admin/UserEditModal";
import { useDebounce } from "@/components/admin/useDebounce";

const PAGE_SIZE = 20;

type Row = AdminUser & { total_count: number };

export default function AdminUsersPage() {
  const me = useProfile();
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<Row | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const q = useDebounce(search.trim());
  const reqId = useRef(0); // عشان نتجاهل أي ردّ قديم وصل بعد ردّ أحدث

  const load = useCallback(async () => {
    const id = ++reqId.current;
    setLoading(true);
    const { data, error: err } = await supabase.rpc("admin_list_users", {
      p_search: q || null,
      p_role: role || null,
      p_limit: PAGE_SIZE,
      p_offset: (page - 1) * PAGE_SIZE,
    });
    if (id !== reqId.current) return;

    setLoading(false);
    if (err) {
      console.error("admin_list_users failed:", err);
      return setError(adminErrorMessage(err, "مقدرناش نحمّل المستخدمين، جرّب تحدّث الصفحة"));
    }
    setError("");
    const list = (data ?? []) as Row[];
    setRows(list);
    setTotal(list[0]?.total_count ?? 0);
  }, [q, role, page]);

  useEffect(() => {
    load();
  }, [load]);

  async function changeRole(u: Row, newRole: string) {
    if (newRole === u.role) return;
    const name = u.full_name || u.email;
    if (newRole === "admin" && !confirm(`ترقية "${name}" لأدمن؟ هيبقى عنده صلاحية على كل حاجة في الموقع.`)) return;

    setBusyId(u.id);
    setError("");
    const { error: err } = await supabase.rpc("admin_set_role", { p_user: u.id, p_role: newRole });
    setBusyId(null);
    if (err) {
      console.error("admin_set_role failed:", err);
      return setError(adminErrorMessage(err, "مقدرناش نغيّر الدور، جرّب تاني"));
    }
    setRows((prev) => prev.map((r) => (r.id === u.id ? { ...r, role: newRole as Row["role"] } : r)));
  }

  return (
    <>
      <div className="adm-head">
        <h1>المستخدمين {total > 0 && <span className="adm-sub">({total.toLocaleString("ar-EG")})</span>}</h1>
      </div>

      <div className="adm-toolbar">
        <input
          type="search"
          placeholder="ابحث بالاسم أو الإيميل أو رقم الهاتف..."
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
        <select
          value={role}
          onChange={(e) => {
            setRole(e.target.value);
            setPage(1);
          }}
          aria-label="فلتر الدور"
        >
          <option value="">كل الأدوار</option>
          <option value="student">طلاب</option>
          <option value="teacher">مدرّسين</option>
          <option value="admin">أدمن</option>
          <option value="essay_grader">مصححين مقالي</option>
          <option value="course_manager">مديري محتوى الكورسات</option>
          <option value="forum_moderator">مسؤولي المنتدى</option>
          <option value="payment_manager">مسؤولي طلبات الدفع</option>
          <option value="support_agent">مسؤولي الدعم</option>
        </select>
      </div>

      {error && <p className="msg-error">{error}</p>}

      <div className="card adm-table-wrap">
        <table className="adm-table">
          <thead>
            <tr>
              <th>الاسم</th>
              <th>الإيميل والهاتف</th>
              <th>السنة</th>
              <th>كورسات</th>
              <th>التسجيل</th>
              <th>الدور</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.id}>
                <td>
                  <strong>{u.full_name || "بدون اسم"}</strong>
                  {u.id === me.id && <span className="adm-sub"> (أنت)</span>}
                </td>
                <td>
                  <div className="adm-ltr">{u.email}</div>
                  <div className="adm-sub adm-ltr">{u.phone ?? "—"}</div>
                </td>
                <td>{GRADES.find((g) => g.value === u.grade)?.label ?? "—"}</td>
                <td>{u.enrollments_count.toLocaleString("ar-EG")}</td>
                <td className="adm-sub">{fmtDate(u.created_at)}</td>
                <td>
                  <select
                    className="adm-inline-select"
                    value={u.role}
                    disabled={u.id === me.id || busyId === u.id}
                    onChange={(e) => changeRole(u, e.target.value)}
                    aria-label={`دور ${u.full_name || u.email}`}
                  >
                    {(["student", "teacher", "admin", "essay_grader", "course_manager", "forum_moderator", "payment_manager", "support_agent"] as const).map((r) => (
                      <option key={r} value={r} disabled={r === "essay_grader" || r === "course_manager" || r === "forum_moderator" || r === "payment_manager" || r === "support_agent"}>{ROLE_LABEL[r]}</option>
                    ))}
                  </select>
                </td>
                <td>
                  <button className="btn btn-outline btn-sm" onClick={() => setEditing(u)}>تعديل</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {loading && rows.length === 0 && <p className="empty">جاري التحميل...</p>}
        {!loading && rows.length === 0 && !error && <p className="empty">مفيش مستخدمين مطابقين للبحث.</p>}
      </div>

      <Pagination page={page} pageSize={PAGE_SIZE} total={total} onChange={setPage} />

      {editing && (
        <UserEditModal
          user={editing}
          onClose={() => setEditing(null)}
          onSaved={(u) => {
            setRows((prev) => prev.map((r) => (r.id === u.id ? { ...r, ...u } : r)));
            setEditing(null);
          }}
        />
      )}
    </>
  );
}
