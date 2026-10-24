"use client";

import { useEffect, useState } from "react";
import InvoicesTab from "@/components/dashboard/billing/InvoicesTab";
import SubscriptionsTab from "@/components/dashboard/billing/SubscriptionsTab";
import MyCoursesTab from "@/components/dashboard/billing/MyCoursesTab";

const TABS = [
  { id: "invoices", label: "الفواتير" },
  { id: "subs", label: "الاشتراكات" },
  { id: "courses", label: "كورساتي" },
] as const;

type TabId = (typeof TABS)[number]["id"];

// تابات الفواتير والاشتراكات (اتنقلت من صفحة billing لصفحة حسابي)
export default function BillingTabs() {
  const [tab, setTab] = useState<TabId>("invoices");

  // #billing-courses (من الرئيسية) يفتح تاب كورساتي مباشرة
  useEffect(() => {
    const t = setTimeout(() => {
      if (window.location.hash === "#billing-courses") setTab("courses");
    }, 100);
    return () => clearTimeout(t);
  }, []);

  return (
    <>
      <div className="bill-tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={`bill-tab${tab === t.id ? " active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* كل تاب بيحمّل بياناته أول ما يتفتح */}
      {tab === "invoices" && <InvoicesTab />}
      {tab === "subs" && <SubscriptionsTab />}
      {tab === "courses" && <MyCoursesTab />}
    </>
  );
}
