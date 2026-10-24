"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { supabase } from "@/lib/supabase";
import "./support-widget.css";

type Ticket = { id: string; subject: string; status: string; updated_at: string; last_message: string | null };

export default function StudentSupportWidget() {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [count, setCount] = useState(0);
  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc("get_my_support_tickets");
    if (error) return;
    const tickets = (data ?? []) as Ticket[];
    setTicket(tickets[0] ?? null);
    setCount(tickets.filter((item) => item.status === "waiting_student").length);
  }, []);

  useEffect(() => { void load(); const timer = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, 5000); return () => window.clearInterval(timer); }, [load]);
  useEffect(() => { if (pathname === "/dashboard/support") setOpen(false); }, [pathname]);

  return <div className="support-widget" dir="rtl">
    {open && <section className="support-widget-panel" aria-label="محادثة الدعم">
      <header><span>منصة EduHelp</span><button type="button" onClick={() => setOpen(false)} aria-label="إغلاق نافذة الدعم"><i className="fa-solid fa-xmark" /></button></header>
      <div className="support-widget-body"><span className="support-widget-icon"><i className="fa-solid fa-headset" /></span><h2>أهلا يا صديقي، الدعم الفني معاك في خدمتك</h2><p>سنرد خلال بضع دقائق</p>{ticket && <small className={ticket.status === "waiting_student" ? "needs-reply" : ""}>{ticket.status === "waiting_student" ? "فريق الدعم رد عليك" : ticket.status === "closed" ? "آخر محادثة مغلقة" : "طلبك وصل لفريق الدعم"}</small>}<button type="button" className="support-widget-open" onClick={() => router.push("/dashboard/support")}>دردش معنا الآن<i className="fa-solid fa-arrow-left" /></button></div>
      <footer><i className="fa-regular fa-clock" /> فريق دعم EduHelp جاهز لمساعدتك</footer>
    </section>}
    <button type="button" className={`support-widget-launcher${open ? " is-open" : ""}`} onClick={() => setOpen((value) => !value)} aria-label={open ? "إغلاق مركز المساعدة" : "فتح مركز المساعدة"} aria-expanded={open}>
      <i className={`fa-solid ${open ? "fa-xmark" : "fa-headset"}`} />{count > 0 && !open && <span className="support-widget-badge">{count > 9 ? "9+" : count}</span>}
    </button>
  </div>;
}
