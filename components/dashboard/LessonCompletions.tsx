"use client";

import Link from "next/link";
import LoadingState from "@/components/dashboard/LoadingState";
import type { LessonCompletion } from "@/components/dashboard/useLessonCompletions";

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ar-EG", { day: "numeric", month: "long", year: "numeric" }).format(new Date(value));
}

export default function LessonCompletions({ completions, loading }: { completions: LessonCompletion[]; loading: boolean }) {
  return (
    <section className="card profile-completions" aria-labelledby="profile-completions-title">
      <div className="profile-section-heading">
        <span className="profile-heading-icon profile-completions-icon"><i className="fa-solid fa-circle-check" /></span>
        <div><h2 id="profile-completions-title">إنجازاتي</h2><p>الدروس ومذكرات PDF اللي أنجزتها، محفوظة في حسابك.</p></div>
        <span className="profile-completions-count">{completions.length.toLocaleString("ar-EG")} إنجاز</span>
      </div>
      {loading ? <LoadingState label="بنحمّل إنجازاتك" detail="لحظة ونجهّز الدروس المكتملة" compact /> : completions.length === 0 ? (
        <div className="profile-completions-empty"><i className="fa-solid fa-book-open-reader" /><b>لسه مفيش إنجازات</b><span>لما تكمّل درس أو تفتح مذكرة، هتلاقيها هنا.</span><Link href="/dashboard/courses" className="btn btn-outline btn-sm">افتح كورساتك</Link></div>
      ) : (
        <div className="profile-completions-list">
          {completions.map((item) => (
            <Link className="profile-completion-row" href={`/dashboard/courses/${item.course_id}`} key={item.lesson_id}>
              <span className="profile-completion-check"><i className="fa-solid fa-check" /></span>
              <span className="profile-completion-copy"><strong>{item.title}</strong><small>{item.course_title}</small></span>
              <time dateTime={item.completed_at}>{formatDate(item.completed_at)}</time>
              <i className="fa-solid fa-arrow-left profile-completion-arrow" />
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
