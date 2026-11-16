import type { Metadata } from "next";
import { createClient } from "@supabase/supabase-js";
import { formatParentReportDate } from "@/components/parent-report/period";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "تقرير متابعة الطالب | EduHelp",
  robots: { index: false, follow: false, googleBot: { index: false, follow: false } },
};

type ParentReport = {
  student_first_name: string;
  period_from: string;
  period_to: string;
  last_login_at: string | null;
  courses: { course_id: string; course_title: string; completed_items: number; total_items: number; progress_percent: number }[];
  exam_results: { exam_title: string; course_title: string | null; score: number | null; total: number | null; percent: number | null; pending_review: boolean; submitted_at: string }[];
  activity: { last_activity_at: string | null; completed_lessons: number; started_exams: number; submitted_exams: number };
};

function dateTime(value: string | null) {
  if (!value) return "لا يوجد نشاط خلال الفترة";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "غير متاح";
  return new Intl.DateTimeFormat("ar-EG", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Cairo" }).format(date);
}

function number(value: number | null) {
  return value === null ? "—" : value.toLocaleString("en-US");
}

async function loadReport(token: string): Promise<ParentReport | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.rpc("get_parent_report", { p_token: token });
  if (error) {
    console.error("parent report request failed:", error.message);
    return null;
  }
  return (data ?? null) as ParentReport | null;
}

export default async function ParentReportPage({ params }: { params: { token: string } }) {
  const report = await loadReport(params.token);
  if (!report) return <main className={styles.page} dir="rtl">
    <section className={styles.invalid}>
      <span className={styles.brandMark}><i className="fa-solid fa-book-open-reader" /></span>
      <b className={styles.brand}>Edu<span>Help</span></b>
      <span className={styles.invalidIcon}><i className="fa-solid fa-link-slash" /></span>
      <h1>الرابط غير صالح أو تم إلغاؤه</h1>
      <p>اطلب من مدرس الطالب إنشاء رابط متابعة جديد.</p>
    </section>
  </main>;

  const periodLabel = `من ${formatParentReportDate(report.period_from)} إلى ${formatParentReportDate(report.period_to)}`;

  return <main className={styles.page} dir="rtl">
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.brandLine}><span className={styles.brandMark}><i className="fa-solid fa-book-open-reader" /></span><b className={styles.brand}>Edu<span>Help</span></b></div>
        <h1>مرحبًا ولي أمر الطالب <span>{report.student_first_name}</span></h1>
        <p>ملخص التقدم والنشاط التعليمي للطالب</p>
        <div className={styles.periodBadge}><i className="fa-regular fa-calendar-days" /> نشاط التقرير {periodLabel}</div>
      </header>
      <section className={styles.activity} aria-label="ملخص النشاط خلال الفترة">
        <article><span><i className="fa-regular fa-clock" /> آخر دخول خلال الفترة</span><strong>{dateTime(report.last_login_at)}</strong></article>
        <article><span><i className="fa-solid fa-book-open" /> دروس اكتملت خلال الفترة</span><strong>{number(report.activity.completed_lessons)}</strong></article>
        <article><span><i className="fa-solid fa-file-circle-check" /> امتحانات بدأها</span><strong>{number(report.activity.started_exams)}</strong></article>
        <article><span><i className="fa-solid fa-paper-plane" /> امتحانات سلّمها</span><strong>{number(report.activity.submitted_exams)}</strong></article>
        <article className={styles.lastActivity}><span><i className="fa-solid fa-chart-line" /> آخر نشاط خلال الفترة</span><strong>{dateTime(report.activity.last_activity_at)}</strong></article>
      </section>
      <section className={styles.section}>
        <div className={styles.sectionHead}><span className={styles.sectionIcon}><i className="fa-solid fa-layer-group" /></span><div><h2>الكورسات والتقدم الإجمالي</h2><p>نسبة الإنجاز محسوبة على تقدم الطالب الكامل في كل كورس، بغض النظر عن فترة التقرير.</p></div></div>
        {report.courses.length === 0 ? <p className={styles.empty}>لا توجد كورسات مسجلة لهذا الطالب حتى الآن.</p> : <div className={styles.courseGrid}>
          {report.courses.map((course) => <article className={styles.course} key={course.course_id}>
            <div className={styles.courseTitle}><h3>{course.course_title}</h3><strong>{course.progress_percent.toLocaleString("en-US")}%</strong></div>
            <div className={styles.progressTrack}><span style={{ width: Math.min(100, Math.max(0, course.progress_percent)) + "%" }} /></div>
            <small>أكمل {number(course.completed_items)} من {number(course.total_items)} عنصر إجمالًا</small>
          </article>)}
        </div>}
      </section>
      <section className={styles.section}>
        <div className={styles.sectionHead}><span className={styles.sectionIcon}><i className="fa-solid fa-square-poll-vertical" /></span><div><h2>نتائج امتحانات الفترة</h2><p>الامتحانات المسلّمة من {formatParentReportDate(report.period_from)} إلى {formatParentReportDate(report.period_to)}، دون عرض إجابات الطالب أو الإجابات الصحيحة.</p></div></div>
        {report.exam_results.length === 0 ? <p className={styles.empty}>لا توجد امتحانات مسلّمة خلال هذه الفترة.</p> : <div className={styles.results}>
          {report.exam_results.map((result, index) => <article className={styles.result} key={result.exam_title + result.submitted_at + index}>
            <div className={styles.resultMain}><h3>{result.exam_title}</h3><span>{result.course_title || "امتحان عام"} · {dateTime(result.submitted_at)}</span></div>
            {result.pending_review ? <span className={styles.pending}>بانتظار التصحيح</span> : <strong className={styles.score}>{number(result.score)} <small>من {number(result.total)}</small></strong>}
          </article>)}
        </div>}
        {report.exam_results.length === 100 && <small className={styles.resultsLimit}>نعرض أحدث 100 نتيجة ضمن الفترة المختارة.</small>}
      </section>
    </div>
  </main>;
}
