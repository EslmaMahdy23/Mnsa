"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type Leader = { user_id: string; student_name: string; average_percent: number; completed_exams: number; rank: number };

export default function ExamLeaderboard({ userId }: { userId: string }) {
  const [rows, setRows] = useState<Leader[]>([]);
  const [examCount, setExamCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    supabase.rpc("get_exam_leaderboard", { p_limit: 10 }).then(({ data, error: rpcError }) => {
      if (!active) return;
      if (rpcError) {
        console.error("exam leaderboard load failed:", rpcError);
        setError(true);
      } else {
        const result = data as { exam_count?: number; leaders?: Leader[] } | null;
        setExamCount(Number(result?.exam_count) || 0);
        setRows(Array.isArray(result?.leaders) ? result.leaders : []);
      }
      setLoading(false);
    });
    return () => { active = false; };
  }, []);

  const me = rows.find((row) => row.user_id === userId);
  return (
    <section className="card" style={{ marginBottom: 16 }}>
      <div className="prof-head" style={{ marginBottom: 14 }}>
        <span className="wt-icon"><i className="fa-solid fa-trophy" /></span>
        <div><h2 style={{ fontSize: "1.15rem" }}>أوائل الامتحانات</h2><p>الترتيب حسب متوسط النتيجة بعد إكمال كل الامتحانات المنشورة</p></div>
        {!loading && examCount > 0 && <span style={{ marginInlineStart: "auto", color: "#718096", fontSize: ".8rem" }}>{examCount.toLocaleString("ar-EG")} امتحان</span>}
      </div>
      {loading ? <p className="empty">جاري تحميل الترتيب...</p> : error ? <p className="msg-error" role="alert">تعذر تحميل ترتيب الطلاب حاليًا.</p> : examCount === 0 ? <p className="empty">لا توجد امتحانات منشورة حاليًا.</p> : rows.length === 0 ? <p className="empty">سيظهر الترتيب بعد أن يكمل الطلاب كل الامتحانات المنشورة.</p> : <>
        <div style={{ display: "grid", gap: 8 }}>
          {rows.map((row) => <div key={row.user_id} style={{ display: "grid", gridTemplateColumns: "42px minmax(0,1fr) auto", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 12, background: row.user_id === userId ? "#eef8fc" : "#f8fafc", border: `1px solid ${row.user_id === userId ? "#b9e3f1" : "#edf1f5"}` }}>
            <span style={{ fontWeight: 800, color: row.rank <= 3 ? "#d39b22" : "#738198" }}>#{row.rank.toLocaleString("ar-EG")}</span>
            <b style={{ color: "#2a3a52", overflow: "hidden", textOverflow: "ellipsis" }}>{row.student_name}{row.user_id === userId ? " (أنت)" : ""}</b>
            <strong style={{ color: "#1688b5" }}>{Number(row.average_percent).toLocaleString("ar-EG", { maximumFractionDigits: 1 })}٪</strong>
          </div>)}
        </div>
        {!me && <p style={{ margin: "12px 2px 0", color: "#718096", fontSize: ".82rem" }}>أكمل كل الامتحانات المنشورة لتظهر في الترتيب.</p>}
      </>}
    </section>
  );
}
