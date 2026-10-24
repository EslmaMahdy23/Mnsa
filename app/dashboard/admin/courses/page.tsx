"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { adminErrorMessage, escapeLike, fmtDate } from "@/lib/admin";
import { GRADES } from "@/lib/validation";
import Pagination from "@/components/admin/Pagination";
import { useDebounce } from "@/components/admin/useDebounce";
import { useProfile } from "@/components/dashboard/ProfileContext";

const PAGE_SIZE = 20;

type Row = {
  id: string;
  title: string;
  grade: number | null;
  price: number;
  is_published: boolean;
  created_at: string;
  teacher: { full_name: string | null } | null;
  enrollments?: { count: number }[];
  lessons: { count: number }[];
};

export default function AdminCoursesPage() {
  const me = useProfile();
  const isContentManager = me.role === "course_manager";
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const q = useDebounce(search.trim());
  const reqId = useRef(0);

  const load = useCallback(async () => {
    const id = ++reqId.current;
    setLoading(true);
    const from = (page - 1) * PAGE_SIZE;

    // طلب واحد: الكورسات + اسم المدرّس + عدد الدروس وعدد المسجّلين (من غير ما نحمّل الدروس نفسها)
    let query = supabase
      .from("courses")
      .select(
        isContentManager
          ? "id, title, grade, price, is_published, created_at, lessons(count)"
          : "id, title, grade, price, is_published, created_at, teacher:profiles!teacher_id(full_name), enrollments(count), lessons(count)",
        { count: "exact" }
      )
      .order("created_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);

    if (q) query = query.ilike("title", `%${escapeLike(q)}%`);
    if (status === "published") query = query.eq("is_published", true);
    if (status === "draft") query = query.eq("is_published", false);

    const { data, count, error: err } = await query;
    if (id !== reqId.current) return;

    setLoading(false);
    if (err) {
      console.error("admin courses load failed:", err);
      return setError("مقدرناش نحمّل الكورسات، جرّب تحدّث الصفحة");
    }
    setError("");
    setRows((data ?? []) as unknown as Row[]);
    setTotal(count ?? 0);
  }, [q, status, page]);

  useEffect(() => {
    load();
  }, [load]);

  async function togglePublish(c: Row) {
    setBusyId(c.id);
    setError("");
    const { data, error: err } = await supabase
      .from("courses")
      .update({ is_published: !c.is_published })
      .eq("id", c.id)
      .select("id");
    setBusyId(null);
    if (err || !data || data.length === 0) {
      console.error("publish toggle failed:", err);
      return setError(adminErrorMessage(err, "مقدرناش نغيّر حالة النشر، جرّب تاني"));
    }
    setRows((prev) => prev.map((r) => (r.id === c.id ? { ...r, is_published: !c.is_published } : r)));
  }

  async function remove(c: Row) {
    const n = c.enrollments?.[0]?.count ?? 0;
    const warn = `حذف الكورس "${c.title}" هيمسح كل دروسه${n > 0 ? ` وتسجيل ${n} طالب فيه` : ""} نهائياً. متأكد؟`;
    if (!confirm(warn)) return;

    setBusyId(c.id);
    setError("");
    const { data, error: err } = await supabase.from("courses").delete().eq("id", c.id).select("id");
    setBusyId(null);
    if (err || !data || data.length === 0) {
      console.error("course delete failed:", err);
      return setError(adminErrorMessage(err, "مقدرناش نحذف الكورس، جرّب تاني"));
    }
    // لو ده كان آخر كورس في الصفحة نرجع صفحة، غير كده نحدّث القائمة
    if (rows.length === 1 && page > 1) setPage(page - 1);
    else load();
  }

  return (
    <>
      <div className="adm-head">
        <h1>الكورسات {total > 0 && <span className="adm-sub">({total.toLocaleString("ar-EG")})</span>}</h1>
        <Link href="/dashboard/admin/courses/new" className="btn">
          <i className="fa-solid fa-plus" /> كورس جديد
        </Link>
      </div>

      <div className="adm-toolbar">
        <input
          type="search"
          placeholder="ابحث بعنوان الكورس..."
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          aria-label="فلتر الحالة"
        >
          <option value="">كل الحالات</option>
          <option value="published">منشور</option>
          <option value="draft">مسودة</option>
        </select>
      </div>

      {error && <p className="msg-error">{error}</p>}

      <div className="card adm-table-wrap">
        <table className="adm-table">
          <thead>
            <tr>
              <th>الكورس</th>
              {!isContentManager && <th>المدرّس</th>}
              <th>السنة</th>
              <th>السعر</th>
              <th>دروس</th>
              {!isContentManager && <th>مسجّلين</th>}
              <th>الحالة</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const price = Number(c.price);
              return (
                <tr key={c.id}>
                  <td>
                    <Link href={`/dashboard/admin/courses/${c.id}`}><strong>{c.title}</strong></Link>
                    <div className="adm-sub">{fmtDate(c.created_at)}</div>
                  </td>
                  {!isContentManager && <td>{c.teacher?.full_name ?? "—"}</td>}
                  <td>{GRADES.find((g) => g.value === c.grade)?.label ?? "كل السنوات"}</td>
                  <td>
                    {price === 0 ? (
                      <span className="adm-badge ok">مجاني</span>
                    ) : (
                      <span className="adm-badge paid">{price.toLocaleString("ar-EG")} جنيه</span>
                    )}
                  </td>
                  <td>{(c.lessons[0]?.count ?? 0).toLocaleString("ar-EG")}</td>
                  {!isContentManager && <td>{(c.enrollments?.[0]?.count ?? 0).toLocaleString("ar-EG")}</td>}
                  <td>
                    <span className={`adm-badge ${c.is_published ? "ok" : "draft"}`}>
                      {c.is_published ? "منشور" : "مسودة"}
                    </span>
                  </td>
                  <td>
                    <div className="adm-actions">
                      <Link href={`/dashboard/admin/courses/${c.id}`} className="btn btn-outline btn-sm">إدارة</Link>
                      <button className="btn btn-outline btn-sm" disabled={busyId === c.id} onClick={() => togglePublish(c)}>
                        {c.is_published ? "إخفاء" : "نشر"}
                      </button>
                      {!isContentManager && <button className="btn btn-danger btn-sm" disabled={busyId === c.id} onClick={() => remove(c)}>حذف</button>}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {loading && rows.length === 0 && <p className="empty">جاري التحميل...</p>}
        {!loading && rows.length === 0 && !error && <p className="empty">مفيش كورسات لسه. اضغط "كورس جديد" وابدأ.</p>}
      </div>

      <Pagination page={page} pageSize={PAGE_SIZE} total={total} onChange={setPage} />
    </>
  );
}
