"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { adminErrorMessage, fmtDate } from "@/lib/admin";
import { GRADES } from "@/lib/validation";
import Pagination from "@/components/admin/Pagination";
import { useDebounce } from "@/components/admin/useDebounce";

const PAGE_SIZE = 10;

type Enrolled = {
  user_id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  grade: number | null;
  enrolled_at: string;
  total_count: number;
};

type Found = { id: string; email: string; full_name: string | null; phone: string | null; grade: number | null };

// المسجّلين في الكورس: عرض، تسجيل طالب (مهم للكورسات المدفوعة)، وإلغاء تسجيل
export default function EnrollmentsManager({ courseId, isPaid }: { courseId: string; isPaid: boolean }) {
  const [rows, setRows] = useState<Enrolled[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [found, setFound] = useState<Found[]>([]);
  const [searching, setSearching] = useState(false);
  const q = useDebounce(search.trim());
  const searchReq = useRef(0);

  const load = useCallback(async () => {
    const { data, error: err } = await supabase.rpc("admin_course_enrollments", {
      p_course: courseId,
      p_limit: PAGE_SIZE,
      p_offset: (page - 1) * PAGE_SIZE,
    });
    setLoading(false);
    if (err) {
      console.error("admin_course_enrollments failed:", err);
      return setError(adminErrorMessage(err, "مقدرناش نحمّل المسجّلين، جرّب تحدّث الصفحة"));
    }
    const list = (data ?? []) as Enrolled[];
    setRows(list);
    setTotal(list[0]?.total_count ?? 0);
  }, [courseId, page]);

  useEffect(() => {
    load();
  }, [load]);

  // البحث عن طالب عشان نسجّله (بعد حرفين على الأقل)
  useEffect(() => {
    if (q.length < 2) {
      setFound([]);
      return;
    }
    const id = ++searchReq.current;
    setSearching(true);
    supabase
      .rpc("admin_list_users", { p_search: q, p_role: "student", p_limit: 5, p_offset: 0 })
      .then(({ data, error: err }) => {
        if (id !== searchReq.current) return;
        setSearching(false);
        if (err) {
          console.error("student search failed:", err);
          return setError(adminErrorMessage(err, "البحث مشتغلش، جرّب تاني"));
        }
        setFound((data ?? []) as Found[]);
      });
  }, [q]);

  async function enroll(s: Found) {
    setBusyId(s.id);
    setError("");
    setOk("");
    const { error: err } = await supabase.from("enrollments").insert({ user_id: s.id, course_id: courseId });
    setBusyId(null);
    // 23505 = الطالب مسجّل بالفعل
    if (err && err.code === "23505") return setError("الطالب ده مسجّل في الكورس بالفعل");
    if (err) {
      console.error("admin enroll failed:", err);
      return setError(adminErrorMessage(err, "مقدرناش نسجّل الطالب، جرّب تاني"));
    }
    setOk(`اتسجّل ${s.full_name || s.email} في الكورس ✔`);
    setSearch("");
    setFound([]);
    setPage(1);
    await load();
  }

  async function unenroll(r: Enrolled) {
    if (!confirm(`إلغاء تسجيل "${r.full_name || r.email}" من الكورس؟`)) return;
    setBusyId(r.user_id);
    setError("");
    setOk("");
    const { data, error: err } = await supabase
      .from("enrollments")
      .delete()
      .eq("course_id", courseId)
      .eq("user_id", r.user_id)
      .select("user_id");
    setBusyId(null);
    if (err || !data || data.length === 0) {
      console.error("admin unenroll failed:", err);
      return setError(adminErrorMessage(err, "مقدرناش نلغي التسجيل، جرّب تاني"));
    }
    if (rows.length === 1 && page > 1) setPage(page - 1);
    else await load();
  }

  return (
    <section className="card adm-section">
      <h2>
        المسجّلين {total > 0 && <span className="adm-sub">({total.toLocaleString("ar-EG")})</span>}
      </h2>

      {isPaid && (
        <p className="hint" style={{ marginBottom: 12 }}>
          الكورس ده مدفوع: الطالب مش بيقدر يسجّل بنفسه، فسجّله من هنا بعد ما يدفع.
        </p>
      )}

      <div className="field" style={{ marginBottom: 6 }}>
        <label htmlFor="e-search">سجّل طالب في الكورس</label>
        <input
          id="e-search"
          type="search"
          placeholder="ابحث بالاسم أو الإيميل أو رقم الهاتف..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {q.length >= 2 && (
        <div style={{ marginBottom: 14 }}>
          {searching && found.length === 0 && <p className="adm-sub">جاري البحث...</p>}
          {!searching && found.length === 0 && <p className="adm-sub">مفيش طالب مطابق.</p>}
          {found.map((s) => (
            <div key={s.id} className="adm-result">
              <div className="adm-result-info">
                <strong>{s.full_name || "بدون اسم"}</strong>
                <div className="adm-sub adm-ltr">{s.email}</div>
                <div className="adm-sub">{GRADES.find((g) => g.value === s.grade)?.label ?? "بدون سنة"}</div>
              </div>
              <button className="btn btn-sm" disabled={busyId === s.id} onClick={() => enroll(s)}>
                {busyId === s.id ? "..." : "سجّل"}
              </button>
            </div>
          ))}
        </div>
      )}

      {error && <p className="msg-error">{error}</p>}
      {ok && <p className="msg-ok">{ok}</p>}

      {loading ? (
        <p className="empty">جاري التحميل...</p>
      ) : rows.length === 0 ? (
        <p className="empty">مفيش طلاب مسجّلين في الكورس لسه.</p>
      ) : (
        <div className="adm-table-wrap" style={{ border: "1px solid var(--border)", borderRadius: 12 }}>
          <table className="adm-table" style={{ minWidth: 520 }}>
            <thead>
              <tr>
                <th>الطالب</th>
                <th>السنة</th>
                <th>تاريخ التسجيل</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.user_id}>
                  <td>
                    <strong>{r.full_name || "بدون اسم"}</strong>
                    <div className="adm-sub adm-ltr">{r.email}</div>
                  </td>
                  <td>{GRADES.find((g) => g.value === r.grade)?.label ?? "—"}</td>
                  <td className="adm-sub">{fmtDate(r.enrolled_at)}</td>
                  <td>
                    <button className="btn btn-danger btn-sm" disabled={busyId === r.user_id} onClick={() => unenroll(r)}>
                      إلغاء التسجيل
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Pagination page={page} pageSize={PAGE_SIZE} total={total} onChange={setPage} />
    </section>
  );
}
