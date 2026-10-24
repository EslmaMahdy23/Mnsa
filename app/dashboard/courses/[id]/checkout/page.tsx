"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useBalance, useProfile, useRefreshProfile } from "@/components/dashboard/ProfileContext";
import { fmtMoney } from "@/lib/wallet";
import { removeCache } from "@/lib/cache";
import LoadingState from "@/components/dashboard/LoadingState";
import "./checkout.css";

type Quote = { course_id: string; course_title: string; price: number; discount: number; total: number; code: string | null; code_type: "percent" | "fixed" | "activation" | null; code_valid: boolean | null; message: string | null; already_enrolled: boolean };
type Receipt = { invoice_no: string; total: number; discount: number; payment_method: string; course_title: string };

export default function CourseCheckoutPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const profile = useProfile();
  const balance = useBalance();
  const refreshProfile = useRefreshProfile();
  const [quote, setQuote] = useState<Quote | null>(null);
  const [code, setCode] = useState("");
  const [appliedCode, setAppliedCode] = useState("");
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [buying, setBuying] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [receipt, setReceipt] = useState<Receipt | null>(null);

  const loadQuote = useCallback(async (promo: string) => {
    const { data, error: err } = await supabase.rpc("preview_course_promo", { p_course: id, p_code: promo || null });
    if (err) throw err;
    return data as Quote;
  }, [id]);

  useEffect(() => {
    let active = true;
    loadQuote("").then((data) => {
      if (!active) return;
      setQuote(data);
      if (data.already_enrolled) router.replace(`/dashboard/courses/${id}`);
    }).catch((err: { code?: string }) => {
      if (active) setError(err.code === "P0002" ? "الكورس غير متاح حاليًا." : "تعذر تحميل تفاصيل الدفع. تأكد من تشغيل ملف 22_course_checkout_promos.sql في Supabase.");
    }).finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [id, loadQuote, router]);

  async function applyCode(event: React.FormEvent) {
    event.preventDefault();
    setChecking(true); setError(""); setNotice("");
    try {
      const normalized = code.trim().toUpperCase();
      const next = await loadQuote(normalized);
      setQuote(next);
      setAppliedCode(next.code_valid === false ? "" : normalized);
      setNotice(next.message ?? (normalized ? "تم تطبيق الكود." : "تم تحديث السعر."));
    } catch {
      setError("مقدرناش نتحقق من الكود دلوقتي. حاول تاني.");
    } finally { setChecking(false); }
  }

  async function purchase() {
    if (!quote || quote.code_valid === false) return;
    setBuying(true); setError("");
    const { data, error: err } = await supabase.rpc("purchase_course_with_code", { p_course: id, p_code: appliedCode || null });
    setBuying(false);
    if (err) {
      if (err.code === "EH001") setError("رصيد محفظتك مش كافي. اشحن رصيدك وبعدها كمّل الدفع.");
      else if (err.code === "23505") setError("أنت مشترك في الكورس بالفعل.");
      else if (err.code === "22023") setError("الكود انتهى أو لم يعد متاحًا. راجع الكود وحاول مرة أخرى.");
      else setError("عملية الدفع ما اكتملتش. حاول تاني بعد لحظات.");
      return;
    }
    setReceipt(data as Receipt);
    setNotice("");
    removeCache(profile.id, "my-enrollments");
    await refreshProfile();
  }

  if (loading) return <LoadingState label="بنجهز صفحة الدفع" detail="بنراجع تفاصيل الكورس والسعر" />;
  if (!quote) return <div className="checkout-page"><p className="msg-error">{error || "الكورس غير متاح."}</p><Link href="/dashboard/courses" className="btn">العودة للكورسات</Link></div>;

  return <div className="checkout-page" dir="rtl">
    <Link href={`/dashboard/courses/${id}`} className="checkout-back"><i className="fa-solid fa-arrow-right" /> معاينة الكورس</Link>
    <header className="checkout-heading"><span className="checkout-heading-icon"><i className="fa-solid fa-shield-halved" /></span><div><span>EduHelp · إتمام آمن</span><h1>{receipt ? "تم تأكيد اشتراكك" : "مراجعة الاشتراك"}</h1><p>راجع تفاصيل الكورس والمبلغ النهائي قبل تأكيد الاشتراك.</p></div></header>
    {receipt ? <section className="checkout-success card"><span className="checkout-success-icon"><i className="fa-solid fa-check" /></span><h2>اشتراكك اتسجل بنجاح</h2><p>الكورس بقى متاحًا في حسابك، وتم تسجيل فاتورة رسمية للعملية.</p><div className="checkout-receipt"><span>رقم الفاتورة</span><b dir="ltr">{receipt.invoice_no}</b><span>المبلغ المدفوع</span><b>{fmtMoney(receipt.total)}</b></div><Link href={`/dashboard/courses/${id}`} className="btn">ابدأ الكورس <i className="fa-solid fa-arrow-left" /></Link></section> : <div className="checkout-layout">
      <section className="checkout-card card">
        <div className="checkout-course"><span className="checkout-course-icon"><i className="fa-solid fa-book-open" /></span><div><small>اشتراك كورس</small><h2>{quote.course_title}</h2><Link href={`/dashboard/courses/${id}`}>ارجع للمعاينة</Link></div></div>
        <div className="checkout-divider" />
        <form className="checkout-promo" onSubmit={applyCode}><label htmlFor="promo-code">كود خصم أو تفعيل</label><div><input id="promo-code" value={code} onChange={(e) => { setCode(e.target.value.toUpperCase()); setAppliedCode(""); setNotice(""); }} placeholder="مثال: EDU20" maxLength={32} autoComplete="off"/><button className="btn btn-outline" disabled={checking}>{checking ? "جارٍ التحقق..." : "تطبيق الكود"}</button></div>{notice && <small className="checkout-notice"><i className="fa-solid fa-circle-check" />{notice}</small>}</form>
        <div className="checkout-summary"><div><span>سعر الكورس</span><b>{fmtMoney(quote.price)}</b></div>{quote.discount > 0 && <div className="checkout-discount"><span>الخصم {appliedCode && <small>({appliedCode})</small>}</span><b>− {fmtMoney(quote.discount)}</b></div>}<div className="checkout-total"><span>الإجمالي</span><b>{quote.code_type === "activation" && appliedCode ? "تفعيل مجاني" : fmtMoney(quote.total)}</b></div></div>
        {error && <p className="checkout-error" role="alert"><i className="fa-solid fa-circle-exclamation" />{error}{error.includes("رصيد") && <> <Link href="/dashboard/wallet">اشحن رصيدك</Link></>}</p>}
        <button className="btn checkout-pay" onClick={purchase} disabled={buying || checking || quote.code_valid === false}>{buying ? <><i className="fa-solid fa-spinner fa-spin" /> جارٍ تأكيد الاشتراك...</> : quote.code_type === "activation" && appliedCode ? <><i className="fa-solid fa-unlock-keyhole" /> فعّل الكورس الآن</> : <><i className="fa-solid fa-lock" /> أكّد الاشتراك · {fmtMoney(quote.total)}</>}</button>
        <p className="checkout-secure"><i className="fa-solid fa-shield-halved" /> {quote.code_type === "activation" && appliedCode ? "كود التفعيل هيسجل اشتراكك من غير خصم من المحفظة." : `الدفع من رصيد محفظتك الحالي${balance === null ? "" : ` · رصيدك ${fmtMoney(balance)}`}.`}</p>
      </section>
      <aside className="checkout-trust"><span><i className="fa-solid fa-file-invoice" /></span><h3>اشتراك موثّق</h3><p>بعد التأكيد، هيتسجل الاشتراك في حسابك وتقدر تراجع الفاتورة من صفحة حسابك.</p><div><i className="fa-solid fa-circle-check" /> فاتورة محفوظة في حسابك</div><div><i className="fa-solid fa-circle-check" /> وصول فوري لمحتوى الكورس</div><div><i className="fa-solid fa-circle-check" /> خصم واضح قبل التأكيد</div></aside>
    </div>}
  </div>;
}
