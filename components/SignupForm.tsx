"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { readAuthReturn } from "@/lib/auth-return";
import { GRADES, cleanPhone, isEgPhone } from "@/lib/validation";
import OtpStep from "./OtpStep";
import "@/app/auth.css";

const empty = { fullName: "", email: "", phone: "", parentPhone: "", grade: "", password: "", confirm: "" };
const signupInstructions = [
  "اكتب اسمك الحقيقي ورقم الواتساب بتاعك ورقم ولي أمرك بشكل صحيح.",
  "احفظ كلمة المرور، وما تشاركهاش مع أي حد.",
  "الفيديو متاح للمشاهدة 5 مرات؛ تأكد من جودة الإنترنت قبل تشغيله.",
  "تابع دروسك وحل الواجبات والامتحانات بانتظام.",
  "قد يتم إرسال تقرير بمستواك لولي أمرك لمتابعة تقدمك.",
  "مشاهدة الفيديو تُحتسب بعد مشاهدة 30% من مدته.",
  "الاشتراكات المدفوعة غير قابلة للاسترداد.",
];

function WizardProgress({ step }: { step: 1 | 2 | 3 | 4 }) {
  return <div className="signup-wizard-progress" aria-label={`الخطوة ${step} من 4`} dir="rtl">
    {[1, 2, 3, 4].map((number, index) => <div className="signup-progress-part" key={number}>
      <span className={`signup-progress-step${step === number ? " current" : step > number ? " completed" : ""}`} aria-current={step === number ? "step" : undefined}>
        {step > number ? <i className="fa-solid fa-check" /> : number.toLocaleString("en-US")}
      </span>
      {index < 3 && <span className={`signup-progress-line${step > number ? " completed" : ""}`} />}
    </div>)}
  </div>;
}

export default function SignupForm() {
  const router = useRouter();
  const [f, setF] = useState(empty);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [otpEmail, setOtpEmail] = useState<string | null>(null);
  const [returnTo, setReturnTo] = useState("/dashboard");
  const [instructionsAccepted, setInstructionsAccepted] = useState(false);

  useEffect(() => { setReturnTo(readAuthReturn()); }, []);
  useEffect(() => {
    if (!error) return;
    const timer = window.setTimeout(() => setError(""), 5200);
    return () => window.clearTimeout(timer);
  }, [error]);

  const set = (key: keyof typeof empty) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setError("");
    setF((current) => ({ ...current, [key]: event.target.value }));
  };

  function validateStep(currentStep: 1 | 2 | 3): string {
    if (currentStep === 1) {
      if (f.fullName.trim().split(/\s+/).length < 4) return "اكتب اسمك رباعي زي ما هو في بياناتك الصحيحة.";
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) return "اكتب بريد إلكتروني صحيح.";
      if (!isEgPhone(cleanPhone(f.phone))) return "رقم الواتساب غير صحيح. اكتبه 11 رقمًا ويبدأ بـ 01.";
      if (f.password.length < 8) return "كلمة المرور لازم تكون 8 أحرف أو أرقام على الأقل.";
      if (f.password !== f.confirm) return "كلمتا المرور مش متطابقتين.";
    }
    if (currentStep === 2 && !f.grade) return "اختار صفك الدراسي عشان نجهز لك المحتوى المناسب.";
    if (currentStep === 3) {
      const phone = cleanPhone(f.phone);
      const parent = cleanPhone(f.parentPhone);
      if (!isEgPhone(parent)) return "رقم ولي الأمر غير صحيح. اكتبه 11 رقمًا ويبدأ بـ 01.";
      if (parent === phone) return "رقم ولي الأمر لازم يكون مختلف عن رقمك.";
    }
    return "";
  }

  function previousStep() {
    setError("");
    setStep((current) => Math.max(1, current - 1) as 1 | 2 | 3);
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const problem = validateStep(step);
    if (problem) return setError(problem);
    setError("");
    if (step < 3) {
      setStep((current) => Math.min(3, current + 1) as 1 | 2 | 3);
      return;
    }
    setLoading(true);
    const email = f.email.trim().toLowerCase();
    try {
      const { data, error: signupError } = await supabase.auth.signUp({
        email,
        password: f.password,
        options: { data: {
          full_name: f.fullName.trim(),
          phone: cleanPhone(f.phone),
          parent_phone: cleanPhone(f.parentPhone),
          grade: Number(f.grade),
        } },
      });
      if (signupError) {
        if (/rate limit/i.test(signupError.message)) return setError("حاولت كتير، استنى شوية وجرب تاني.");
        return setError(`حصل خطأ: ${signupError.message}`);
      }
      if (data.user && data.user.identities?.length === 0) return setError("البريد ده مسجل بالفعل. سجّل الدخول بدل إنشاء حساب جديد.");
      if (data.session) return router.push(readAuthReturn());
      setOtpEmail(email);
    } catch {
      setError("تعذر إنشاء الحساب بسبب مشكلة في الاتصال. راجع الإنترنت وحاول مرة تانية.");
    } finally {
      setLoading(false);
    }
  }

  const shellClass = "auth-wrap auth-screen auth-screen-signup";

  if (otpEmail) {
    return <div className={shellClass}>
      <section className="card auth-card wide signup-wizard-card" dir="rtl">
        <Link href="/" className="signup-wizard-home"><i className="fa-solid fa-house" /> الرئيسية</Link>
        <Link href="/" className="auth-logo auth-brand">Edu<span>Help</span><i className="fa-solid fa-book-open-reader" /></Link>
        <h1 className="signup-welcome">أهلًا بيك</h1>
        <p className="auth-sub">باقي خطوة واحدة ونكون خلصنا.</p>
        <WizardProgress step={4} />
        <div className="signup-wizard-step signup-otp-step"><OtpStep email={otpEmail} onBack={() => setOtpEmail(null)} redirectTo={returnTo} /></div>
      </section>
    </div>;
  }

  const stepInfo = {
    1: { title: "البيانات الأساسية", subtitle: "هنستخدم بياناتك عشان نجهز حسابك ونقدر نتواصل معاك." },
    2: { title: "بياناتك الدراسية", subtitle: "اختار صفك عشان يظهر لك المحتوى المناسب ليك." },
    3: { title: "بيانات ولي الأمر", subtitle: "رقم ولي الأمر مهم لمتابعة تقدمك والتواصل عند الحاجة." },
  }[step];

  return (
    <div className={shellClass}>
      <section className="card auth-card wide signup-wizard-card" dir="rtl">
        <Link href="/" className="signup-wizard-home"><i className="fa-solid fa-house" /> الرئيسية</Link>
        <Link href="/" className="auth-logo auth-brand">Edu<span>Help</span><i className="fa-solid fa-book-open-reader" /></Link>
        <h1 className="signup-welcome">مرحبًا بيك</h1>
        <p className="auth-sub">إنشاء حساب جديد للبدء</p>
        <WizardProgress step={step} />
        <div className="signup-wizard-step-head"><span>الخطوة {step.toLocaleString("en-US")} من 4</span><h2>{stepInfo.title}</h2><p>{stepInfo.subtitle}</p></div>

        <form className={`signup-wizard-fields step-${step}`} onSubmit={onSubmit} noValidate>
          {step === 1 && <>
            <div className="field auth-field">
              <label htmlFor="fullName">الاسم رباعي<span className="req">*</span></label>
              <div className="auth-control"><i className="fa-solid fa-user" /><input id="fullName" value={f.fullName} onChange={set("fullName")} autoComplete="name" placeholder="اكتب اسمك رباعي" /></div>
            </div>
            <div className="field auth-field">
              <label htmlFor="email">البريد الإلكتروني<span className="req">*</span></label>
              <div className="auth-control"><i className="fa-solid fa-envelope" /><input id="email" type="email" dir="ltr" value={f.email} onChange={set("email")} autoComplete="email" placeholder="name@example.com" /></div>
            </div>
            <div className="field auth-field">
              <label htmlFor="phone">رقم الواتساب<span className="req">*</span></label>
              <div className="auth-control"><i className="fa-solid fa-phone" /><input id="phone" type="tel" inputMode="numeric" dir="ltr" placeholder="01012345678" value={f.phone} onChange={set("phone")} autoComplete="tel" /></div>
            </div>
            <div className="field auth-field">
              <label htmlFor="password">كلمة المرور<span className="req">*</span></label>
              <div className="pw-wrap auth-control"><i className="fa-solid fa-lock" /><input id="password" type={showPw ? "text" : "password"} dir="ltr" value={f.password} onChange={set("password")} autoComplete="new-password" placeholder="8 أحرف أو أكثر" /><button type="button" className="pw-toggle signup-password-toggle" aria-label={showPw ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"} title={showPw ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"} onClick={() => setShowPw((value) => !value)}><i className={`fa-solid ${showPw ? "fa-eye-slash" : "fa-eye"}`} /></button></div>
            </div>
            <div className="field auth-field">
              <label htmlFor="confirm">تأكيد كلمة المرور<span className="req">*</span></label>
              <div className="auth-control"><i className="fa-solid fa-lock" /><input id="confirm" type={showPw ? "text" : "password"} dir="ltr" value={f.confirm} onChange={set("confirm")} autoComplete="new-password" placeholder="أعد كتابة كلمة المرور" /></div>
            </div>
          </>}

          {step === 2 && <div className="signup-grade-wrap">
            <label htmlFor="grade">الصف الدراسي<span className="req">*</span></label>
            <div className="auth-control"><i className="fa-solid fa-graduation-cap" /><select id="grade" value={f.grade} onChange={set("grade")}>
              <option value="">اختار الصف الدراسي</option>
              {GRADES.map((grade) => <option key={grade.value} value={grade.value}>{grade.label}</option>)}
            </select></div>
            <div className="signup-grade-note"><i className="fa-solid fa-circle-info" /> تقدر تعدّل الصف الدراسي بعد إنشاء الحساب من ملفك الشخصي.</div>
          </div>}

          {step === 3 && <div className="signup-parent-wrap">
            <span className="signup-parent-icon"><i className="fa-solid fa-user-shield" /></span>
            <label htmlFor="parentPhone">رقم ولي الأمر<span className="req">*</span></label>
            <p>اكتب رقمًا نقدر نستخدمه للتواصل ومتابعة مستواك الدراسي.</p>
            <div className="auth-control"><i className="fa-solid fa-phone" /><input id="parentPhone" type="tel" inputMode="numeric" dir="ltr" placeholder="01012345678" value={f.parentPhone} onChange={set("parentPhone")} autoComplete="tel" /></div>
          </div>}

          <div className="signup-wizard-actions">
            {step > 1 && <button type="button" className="signup-wizard-back" onClick={previousStep}><i className="fa-solid fa-arrow-right" /> السابق</button>}
            <button type="submit" className="btn auth-submit signup-wizard-next" disabled={loading}>
              {loading ? <><i className="fa-solid fa-spinner fa-spin" /> جاري إنشاء الحساب</> : step === 3 ? <>إنشاء الحساب وإرسال الكود <i className="fa-solid fa-envelope-circle-check" /></> : <>التالي <i className="fa-solid fa-arrow-left" /></>}
            </button>
          </div>
        </form>
        <p className="auth-foot signup-wizard-login">عندك حساب؟ <Link href={returnTo === "/dashboard" ? "/login" : `/login?next=${encodeURIComponent(returnTo)}`}>سجّل الدخول</Link></p>
      </section>
      {error && <p className="msg-error signup-wizard-error">{error}</p>}
      {!instructionsAccepted && <div className="signup-instructions-overlay">
        <section className="signup-instructions-card" role="dialog" aria-modal="true" aria-labelledby="signup-instructions-title" dir="rtl">
          <span className="signup-instructions-kicker"><i className="fa-solid fa-circle-info" /> قبل ما تبدأ</span>
          <h2 id="signup-instructions-title">تعليمات مهمة قبل إنشاء الحساب</h2>
          <p className="signup-instructions-intro">اقرأ التعليمات دي كويس قبل ما تكمل تسجيل بياناتك.</p>
          <ol className="signup-instructions-list">{signupInstructions.map((instruction, index) => <li key={instruction}><span>{(index + 1).toLocaleString("en-US")}</span><p>{instruction}</p></li>)}</ol>
          <button type="button" className="btn auth-submit signup-instructions-continue" onClick={() => setInstructionsAccepted(true)}><i className="fa-solid fa-circle-check" /> قرأت التعليمات، أكمل التسجيل</button>
        </section>
      </div>}
    </div>
  );
}
