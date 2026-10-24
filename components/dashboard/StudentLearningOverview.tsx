"use client";

import Link from "next/link";
import type { CSSProperties } from "react";
import type { LessonCompletion } from "@/components/dashboard/useLessonCompletions";

const DAY_LABELS = ["السبت", "الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة"];
const DAY_MS = 24 * 60 * 60 * 1000;

function startOfSaturdayWeek(date: Date) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - ((start.getDay() + 1) % 7));
  return start;
}

function chartValues(completions: LessonCompletion[]) {
  const currentStart = startOfSaturdayWeek(new Date());
  const previousStart = new Date(currentStart.getTime() - 7 * DAY_MS);
  const current = Array(7).fill(0) as number[];
  const previous = Array(7).fill(0) as number[];
  completions.forEach((row) => {
    const date = new Date(row.completed_at);
    const offset = Math.floor((new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() - currentStart.getTime()) / DAY_MS);
    if (offset >= 0 && offset < 7) current[offset] += 1;
    else if (offset >= -7 && offset < 0) previous[offset + 7] += 1;
  });
  return { current, previous };
}

function ActivityChart({ completions }: { completions: LessonCompletion[] }) {
  const { current, previous } = chartValues(completions);
  const max = Math.max(1, ...current, ...previous);
  const width = 700;
  const height = 200;
  const left = 38;
  const right = 12;
  const top = 16;
  const bottom = 38;
  const x = (index: number) => left + (index * (width - left - right)) / 6;
  const y = (value: number) => top + ((max - value) * (height - top - bottom)) / max;
  const line = (values: number[]) => values.map((value, index) => `${index === 0 ? "M" : "L"} ${x(index)} ${y(value)}`).join(" ");

  return (
    <section className="card learning-activity" aria-labelledby="learning-activity-title">
      <div className="learning-panel-title"><span className="learning-panel-icon"><i className="fa-solid fa-chart-line" /></span><div><h2 id="learning-activity-title">نشاطك التعليمي</h2><p>عدد الدروس والملفات اللي أنجزتها كل يوم</p></div></div>
      <div className="learning-chart-legend"><span><i className="previous" /> الأسبوع الماضي</span><span><i className="current" /> الأسبوع الحالي</span></div>
      <svg className="learning-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="مقارنة إنجازات الأسبوع الحالي بالأسبوع الماضي">
        {Array.from({ length: 5 }, (_, index) => {
          const value = Math.round((max * (4 - index)) / 4);
          const gy = y(value);
          return <g key={index}><line x1={left} x2={width - right} y1={gy} y2={gy} className="learning-gridline" /><text x={left - 8} y={gy + 4} textAnchor="end" className="learning-axis-label">{value}</text></g>;
        })}
        {DAY_LABELS.map((label, index) => <g key={label}><line x1={x(index)} x2={x(index)} y1={top} y2={height - bottom} className="learning-gridline vertical" /><text x={x(index)} y={height - 10} textAnchor="middle" className="learning-axis-label">{label}</text></g>)}
        <path d={line(previous)} className="learning-line previous" />
        <path d={line(current)} className="learning-line current" />
        {previous.map((value, index) => <circle key={`p${index}`} cx={x(index)} cy={y(value)} r="3.5" className="learning-point previous" />)}
        {current.map((value, index) => <circle key={`c${index}`} cx={x(index)} cy={y(value)} r="3.5" className="learning-point current" />)}
      </svg>
      {completions.length === 0 && <p className="learning-chart-empty">ابدأ بإنجاز درس أو فتح مذكرة، وهتظهر هنا متابعتك الأسبوعية.</p>}
    </section>
  );
}

export default function StudentLearningOverview({
  completions,
  totalLessons,
  activeCourse,
}: {
  completions: LessonCompletion[];
  totalLessons: number;
  activeCourse: { id: string; title: string } | null;
}) {
  const completed = Math.min(completions.length, totalLessons);
  const percent = totalLessons > 0 ? Math.round((completed / totalLessons) * 100) : 0;
  const remaining = Math.max(0, totalLessons - completed);
  const recent = completions[0];
  return (
    <section className="learning-overview" aria-label="ملخص التقدم التعليمي">
      <div className="card learning-progress-card">
        <div className="learning-ring" style={{ "--learning-percent": `${percent}%` } as CSSProperties}>
          <div><b>{percent.toLocaleString("ar-EG")}%</b><small>إنجاز</small></div>
        </div>
        <strong className="learning-progress-label">تقدمك</strong>
        <p>أنجزت {completed.toLocaleString("ar-EG")} من {totalLessons.toLocaleString("ar-EG")} درسًا في كورساتك الحالية.</p>
        <span className="learning-remaining">{remaining.toLocaleString("ar-EG")} درس متبقي</span>
        {activeCourse ? <Link href={`/dashboard/courses/${activeCourse.id}`} className="btn learning-continue">كمّل مذاكرة <i className="fa-solid fa-arrow-left" /></Link> : <Link href="/dashboard/courses" className="btn learning-continue">تصفّح الكورسات</Link>}
        {recent && <div className="learning-last"><small>آخر إنجاز</small><Link href={`/dashboard/courses/${recent.course_id}`}>{recent.title} · {recent.course_title}</Link></div>}
      </div>
      <ActivityChart completions={completions} />
    </section>
  );
}
