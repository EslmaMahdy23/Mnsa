"use client";

import { useState } from "react";
import type { ParentReportPeriod } from "./period";
import { defaultParentReportPeriod } from "./period";
import styles from "./parent-report-period.module.css";

type Props = {
  value: ParentReportPeriod;
  onChange: (period: ParentReportPeriod) => void;
};

export default function ParentReportPeriodPicker({ value, onChange }: Props) {
  const [mode, setMode] = useState<"week" | "custom">("week");
  const valid = Boolean(value.from && value.to && value.from <= value.to);

  function chooseMode(next: "week" | "custom") {
    setMode(next);
    if (next === "week") onChange(defaultParentReportPeriod());
  }

  return <section className={styles.picker} aria-label="فترة تقرير ولي الأمر">
    <div className={styles.heading}>
      <span className={styles.icon}><i className="fa-regular fa-calendar-days" /></span>
      <div><strong>فترة تقرير ولي الأمر</strong><small>تقدم الكورسات يظل إجماليًا، والنشاط والنتائج حسب الفترة</small></div>
    </div>
    <div className={styles.controls}>
      <div className={styles.modes} role="group" aria-label="اختيار الفترة">
        <button type="button" className={mode === "week" ? styles.active : ""} onClick={() => chooseMode("week")}>
          <i className="fa-solid fa-clock-rotate-left" /> آخر 7 أيام
        </button>
        <button type="button" className={mode === "custom" ? styles.active : ""} onClick={() => chooseMode("custom")}>
          <i className="fa-regular fa-calendar" /> فترة مخصصة
        </button>
      </div>
      {mode === "custom" && <div className={styles.dates}>
        <label>من <input type="date" value={value.from} max={value.to || undefined} onChange={(event) => onChange({ ...value, from: event.target.value })} /></label>
        <label>إلى <input type="date" value={value.to} min={value.from || undefined} onChange={(event) => onChange({ ...value, to: event.target.value })} /></label>
      </div>}
      {!valid && <small className={styles.error}>اختار تاريخ بداية ونهاية صحيحين.</small>}
    </div>
  </section>;
}
