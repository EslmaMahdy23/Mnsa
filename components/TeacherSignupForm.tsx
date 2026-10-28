"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { cleanPhone, isEgPhone, toEnDigits } from "@/lib/validation";
import {
  EXPERIENCE_OPTIONS,
  GOVERNORATES,
  PHOTO_TYPES,
  STAGE_GRADE_OPTIONS,
  STAGE_LABELS,
  STAGE_OPTIONS,
  TEACHER_BUCKET,
  checkCv,
  checkPhoto,
  formatBytes,
  isFullName,
  isValidNationalId,
  normalizeNationalId,
  teacherErrorMessage,
} from "@/lib/teacher-application";
import OtpStep from "./OtpStep";
import "@/app/auth.css";
import "@/app/teacher-signup.css";

const empty = {
  fullName: "", nationalId: "", phone: "", altPhone: "", email: "",
  governorate: "", city: "", qualification: "", graduationYear: "",
  postgraduate: "", experience: "", workplaces: "", subjects: "",
  password: "", confirm: "",
};

type Stage = "form" | "otp" | "finish" | "done";
type ExistingApp = { status: "pending" | "approved" | "rejected"; admin_note: string | null; created_at: string };

function toggle<T>(list: T[], v: T): T[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

function Field({ id, label, optional, wide, hint, children }: {
  id: string; label: string; optional?: boolean; wide?: boolean; hint?: string; children: React.ReactNode;
}) {
  return (
    <div className={`field auth-field${wide ? " ts-wide" : ""}`}>
      <label htmlFor={id}>
        {label}
        {optional ? <span className="ts-opt"> (اختياري)</span> : <span className="req">*</span>}
      </label>
      {children}
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}

export default function TeacherSignupForm() {
  const [ready, setReady] = useState(false);
  const [sessionEmail, setSessionEmail] = useState(""); // لو المستخدم مسجّل دخول بالفعل
  const [existing, setExisting] = useState<ExistingApp | null>(null);
  const [resubmit, setResubmit] = useState(false);

  const [stage, setStage] = useState<Stage>("form");
  const [f, setF] = useState(empty);
  const [stages, setStages] = useState<string[]>([]);
  const [stageGrades, setStageGrades] = useState<Record<string, number[]>>({}); // الصفوف المختارة لكل مرحلة
  const [cv, setCv] = useState<File | null>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoUrl, setPhotoUrl] = useState("");
  const [cvErr, setCvErr] = useState("");
  const [photoErr, setPhotoErr] = useState("");
  const [agree, setAgree] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [otpEmail, setOtpEmail] = useState<string | null>(null);

  const set = (k: keyof typeof empty) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const value = e.target.value;
    setF((prev) => ({ ...prev, [k]: value }));
  };

  // هل المستخدم مسجّل دخول؟ وهل عنده طلب سابق؟
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getSession();
      const user = data.session?.user;
      if (user && !cancelled) {
        setSessionEmail(user.email ?? "");
        const { data: app } = await supabase
          .from("teacher_applications")
          .select("status, admin_note, created_at")
          .eq("user_id", user.id)
          .maybeSingle();
        if (app && !cancelled) setExisting(app as ExistingApp);
      }
      if (!cancelled) setReady(true);
    })();
    return () => { cancelled = true; };
  }, []);

  // معاينة الصورة
  useEffect(() => {
    if (!photo) { setPhotoUrl(""); return; }
    const url = URL.createObjectURL(photo);
    setPhotoUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  async function onCvChange(e: React.ChangeEvent<HTMLInputElement>) {
    const input = e.target;
    const file = input.files?.[0] ?? null;
    setCvErr("");
    if (!file) return setCv(null);
    const problem = await checkCv(file);
    if (problem) {
      input.value = "";
      setCv(null);
      return setCvErr(problem);
    }
    setCv(file);
  }

  function onPhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const input = e.target;
    const file = input.files?.[0] ?? null;
    setPhotoErr("");
    if (!file) return setPhoto(null);
    const problem = checkPhoto(file);
    if (problem) {
      input.value = "";
      setPhoto(null);
      return setPhotoErr(problem);
    }
    setPhoto(file);
  }

  function validate(): string {
    if (!isFullName(f.fullName)) return "اكتب الاسم بالكامل زي البطاقة (ثلاثي أو رباعي)";
    if (!isValidNationalId(f.nationalId)) return "الرقم القومي غير صحيح (14 رقم)";
    const phone = cleanPhone(f.phone);
    const alt = cleanPhone(f.altPhone);
    if (!isEgPhone(phone)) return "رقم الواتساب غير صحيح (مثال: 01012345678)";
    if (!isEgPhone(alt)) return "الرقم البديل غير صحيح (مثال: 01012345678)";
    if (phone === alt) return "الرقم البديل لازم يكون مختلف عن رقم الواتساب";
    if (!sessionEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) return "البريد الإلكتروني غير صحيح";
    if (!f.governorate) return "اختار المحافظة";
    if (f.city.trim().length < 2) return "اكتب المدينة / المنطقة";
    if (f.qualification.trim().length < 3) return "اكتب المؤهل الدراسي (الكلية والجامعة والمؤهل)";
    const year = Number(toEnDigits(f.graduationYear).trim());
    if (!/^\d{4}$/.test(toEnDigits(f.graduationYear).trim()) || year < 1970 || year > new Date().getFullYear()) return "سنة التخرج غير صحيحة";
    if (!f.experience) return "اختار عدد سنوات الخبرة";
    if (f.subjects.trim().length < 2) return "اكتب المادة أو المواد اللي بتدرّسها";
    if (stages.length === 0) return "اختار مرحلة تعليمية واحدة على الأقل";
    for (const s of stages) {
      if (STAGE_GRADE_OPTIONS[s] && !stageGrades[s]?.length) return `حدّد صف واحد على الأقل من ${STAGE_LABELS[s] ?? "المرحلة"}`;
    }
    if (!cv) return cvErr || "ارفع السيرة الذاتية بصيغة PDF";
    if (!photo) return photoErr || "ارفع صورة شخصية حديثة";
    if (!sessionEmail) {
      if (f.password.length < 8) return "كلمة السر لازم تكون 8 حروف أو أرقام على الأقل";
      if (f.password !== f.confirm) return "كلمتا السر غير متطابقتين";
    }
    if (!agree) return "لازم تأكد صحة البيانات علشان نكمّل";
    return "";
  }

  // رفع الملفات + حفظ الطلب (بعد ما الحساب يبقى مسجّل دخول)
  async function finalize() {
    setError("");
    setStage("finish");
    setBusy(true);
    try {
      const { data } = await supabase.auth.getSession();
      const user = data.session?.user;
      if (!user) throw new Error("no_session");
      if (!cv || !photo) throw new Error("missing_files");

      const cvPath = `${user.id}/cv.pdf`;
      const photoPath = `${user.id}/photo.${PHOTO_TYPES[photo.type as keyof typeof PHOTO_TYPES]}`;

      const upCv = await supabase.storage.from(TEACHER_BUCKET).upload(cvPath, cv, { upsert: true, contentType: "application/pdf" });
      if (upCv.error) throw upCv.error;
      const upPhoto = await supabase.storage.from(TEACHER_BUCKET).upload(photoPath, photo, { upsert: true, contentType: photo.type });
      if (upPhoto.error) throw upPhoto.error;

      // الصفوف للمراحل المختارة بس (لو لغى مرحلة بعد ما اختار صفوفها ما تتبعتش)
      const cleanGrades: Record<string, number[]> = {};
      for (const s of stages) {
        if (STAGE_GRADE_OPTIONS[s]) cleanGrades[s] = [...(stageGrades[s] ?? [])].sort((a, b) => a - b);
      }

      const { error: rpcError } = await supabase.rpc("submit_teacher_application", {
        p: {
          full_name: f.fullName.trim().replace(/\s+/g, " "),
          national_id: normalizeNationalId(f.nationalId),
          phone: cleanPhone(f.phone),
          alt_phone: cleanPhone(f.altPhone),
          governorate: f.governorate,
          city: f.city.trim(),
          qualification: f.qualification.trim(),
          graduation_year: toEnDigits(f.graduationYear).trim(),
          specialization: f.subjects.trim().slice(0, 100), // عمود التخصص لسه في الداتابيز، فبنبعت فيه المادة
          postgraduate: f.postgraduate.trim(),
          experience_range: f.experience,
          previous_workplaces: f.workplaces.trim(),
          subjects: f.subjects.trim(),
          stages,
          stage_grades: cleanGrades,
          primary_grades: cleanGrades.primary ?? [],
          cv_path: cvPath,
          photo_path: photoPath,
        },
      });
      if (rpcError) throw rpcError;
      setStage("done");
    } catch (e) {
      console.error("teacher application failed:", e);
      setError(teacherErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const problem = validate();
    if (problem) return setError(problem);
    setError("");

    // مسجّل دخول بالفعل (طالب عايز يقدّم، أو كمّل بعد انقطاع): نحفظ الطلب على حسابه
    if (sessionEmail) return finalize();

    setBusy(true);
    const email = f.email.trim().toLowerCase();
    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password: f.password,
      options: { data: { full_name: f.fullName.trim().replace(/\s+/g, " "), phone: cleanPhone(f.phone) } },
    });
    setBusy(false);

    if (signUpError) {
      if (/rate limit/i.test(signUpError.message)) return setError("حاولت كتير، استنى شوية وجرّب تاني");
      return setError(`حصل خطأ: ${signUpError.message}`);
    }
    // البريد متسجّل ومؤكَّد قبل كده (Supabase بيرجّع مستخدم فاضي من غير خطأ)
    if (data.user && data.user.identities?.length === 0) {
      return setError("البريد ده مسجّل بالفعل. سجّل الدخول بحسابك وارجع لنفس الصفحة وهتقدر تقدّم الطلب عليه");
    }
    if (data.session) return finalize(); // لو تأكيد البريد مقفول
    setOtpEmail(email);
    setStage("otp");
  }

  if (!ready) {
    return (
      <div className="auth-wrap auth-screen">
        <div className="card auth-card"><p className="auth-sub">برجاء الانتظار...</p></div>
      </div>
    );
  }

  if (stage === "otp" && otpEmail) {
    return (
      <div className="auth-wrap auth-screen">
        <div className="card auth-card">
          <OtpStep email={otpEmail} onBack={() => { setStage("form"); setOtpEmail(null); }} onVerified={finalize} />
        </div>
      </div>
    );
  }

  if (stage === "finish") {
    return (
      <div className="auth-wrap auth-screen">
        <div className="card auth-card ts-status">
          <h1>{busy ? "بنرفع بياناتك..." : "مكمّلناش الإرسال"}</h1>
          {busy ? (
            <p className="auth-sub">برجاء عدم إغلاق الصفحة لحد ما نخلّص رفع الملفات وحفظ الطلب.</p>
          ) : (
            <>
              {error && <p className="msg-error">{error}</p>}
              <p className="auth-sub">حسابك اتأكد بالفعل، فاضل بس نرفع الملفات ونحفظ الطلب.</p>
              <button type="button" className="btn auth-submit" style={{ width: "100%" }} onClick={finalize}>إعادة المحاولة</button>
              <div className="otp-actions">
                <button type="button" className="link-btn" onClick={() => { setStage("form"); setError(""); }}>رجوع للفورم</button>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  if (stage === "done") {
    return (
      <div className="auth-wrap auth-screen">
        <div className="card auth-card ts-status">
          <div className="ts-status-icon ok"><i className="fa-solid fa-circle-check" /></div>
          <h1>وصلنا طلبك</h1>
          <p className="auth-sub">
            هنراجع بياناتك وسيرتك الذاتية، وهيوصلك إيميل أول ما تتم الموافقة. لحد وقتها، كل ما تدخل بنفس البريد وكلمة السر هتلاقي حالة طلبك "قيد المراجعة"، وبعد الموافقة هتفتح لك لوحة المدرّس الخاصة بيك.
          </p>
          <Link href="/dashboard" className="btn auth-submit" style={{ width: "100%", textAlign: "center" }}>الذهاب لحسابي</Link>
        </div>
      </div>
    );
  }

  // لو عنده طلب سابق وما اخترناش يقدّم من جديد: نعرض حالته
  if (existing && !resubmit) {
    const meta = {
      pending: { icon: "fa-hourglass-half", cls: "wait", title: "طلبك قيد المراجعة", text: "وصلنا طلبك وفريقنا بيراجعه. هنتواصل معاك أول ما نخلّص." },
      approved: { icon: "fa-circle-check", cls: "ok", title: "تم قبول طلبك", text: "حسابك متفعّل كمدرّس. ادخل على لوحة الحساب وابدأ." },
      rejected: { icon: "fa-circle-xmark", cls: "no", title: "اتعذّر قبول طلبك", text: "تقدر تعدّل بياناتك وتقدّم الطلب تاني." },
    }[existing.status];
    return (
      <div className="auth-wrap auth-screen">
        <div className="card auth-card ts-status">
          <div className={`ts-status-icon ${meta.cls}`}><i className={`fa-solid ${meta.icon}`} /></div>
          <h1>{meta.title}</h1>
          <p className="auth-sub">{meta.text}</p>
          {existing.status === "rejected" && existing.admin_note && (
            <p className="ts-note"><b>ملاحظة الفريق:</b> {existing.admin_note}</p>
          )}
          {existing.status === "rejected"
            ? <button type="button" className="btn auth-submit" style={{ width: "100%" }} onClick={() => setResubmit(true)}>تقديم طلب جديد</button>
            : <Link href="/dashboard" className="btn auth-submit" style={{ width: "100%", textAlign: "center" }}>الذهاب لحسابي</Link>}
        </div>
      </div>
    );
  }

  return (
    <div className="auth-wrap auth-screen auth-screen-signup auth-screen-teacher">
      <div className="card auth-card wide">
        <Link href="/" className="auth-logo auth-brand">Edu<span>Help</span><i className="fa-solid fa-book-open-reader" /></Link>
        <h1>التسجيل كمدرّس</h1>
        <p className="auth-sub">
          املا بياناتك بدقة زي ما هي في البطاقة. هنراجع الطلب وبعد الموافقة هيتفعّل حسابك كمدرّس.
          {sessionEmail && <><br />هيتم حفظ الطلب على حسابك الحالي: <b dir="ltr">{sessionEmail}</b></>}
        </p>

        <form className="auth-signup-form" onSubmit={onSubmit} noValidate>
          <h2 className="ts-section-title"><i className="fa-solid fa-id-card" /> البيانات الشخصية</h2>

          <Field id="fullName" label="الاسم بالكامل (ثلاثي أو رباعي كما في البطاقة)" wide>
            <div className="auth-control"><i className="fa-solid fa-user" /><input id="fullName" value={f.fullName} onChange={set("fullName")} autoComplete="name" placeholder="الاسم بالكامل" /></div>
          </Field>

          <Field id="nationalId" label="الرقم القومي" hint="14 رقم، للتأكد من الهوية الرسمية فقط، ومش بيظهر لأي حد غير فريق الإدارة.">
            <div className="auth-control"><i className="fa-solid fa-address-card" /><input id="nationalId" inputMode="numeric" dir="ltr" maxLength={20} value={f.nationalId} onChange={set("nationalId")} autoComplete="off" placeholder="29901011234567" /></div>
          </Field>

          <Field id="email" label="البريد الإلكتروني (للمراسلات الرسمية)">
            <div className="auth-control"><i className="fa-solid fa-envelope" />
              <input id="email" type="email" dir="ltr" value={sessionEmail || f.email} onChange={set("email")} readOnly={!!sessionEmail} autoComplete="email" placeholder="البريد الإلكتروني" />
            </div>
          </Field>

          <Field id="phone" label="رقم الهاتف الأساسي (واتساب)">
            <div className="auth-control"><i className="fa-brands fa-whatsapp" /><input id="phone" type="tel" inputMode="numeric" dir="ltr" value={f.phone} onChange={set("phone")} autoComplete="tel" placeholder="01012345678" /></div>
          </Field>

          <Field id="altPhone" label="رقم هاتف بديل (للطوارئ)">
            <div className="auth-control"><i className="fa-solid fa-phone" /><input id="altPhone" type="tel" inputMode="numeric" dir="ltr" value={f.altPhone} onChange={set("altPhone")} placeholder="01112345678" /></div>
          </Field>

          <Field id="governorate" label="المحافظة">
            <div className="auth-control"><i className="fa-solid fa-location-dot" />
              <select id="governorate" value={f.governorate} onChange={set("governorate")}>
                <option value="">اختار المحافظة</option>
                {GOVERNORATES.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
          </Field>

          <Field id="city" label="المدينة / المنطقة (محل الإقامة)">
            <div className="auth-control"><i className="fa-solid fa-city" /><input id="city" value={f.city} onChange={set("city")} maxLength={80} placeholder="المدينة أو الحي" /></div>
          </Field>

          <h2 className="ts-section-title"><i className="fa-solid fa-graduation-cap" /> المؤهلات والخبرة</h2>

          <Field id="qualification" label="المؤهل الدراسي (الكلية والجامعة والمؤهل)" wide>
            <div className="auth-control"><i className="fa-solid fa-building-columns" /><input id="qualification" value={f.qualification} onChange={set("qualification")} maxLength={200} placeholder="مثال: بكالوريوس تربية، جامعة القاهرة" /></div>
          </Field>

          <Field id="graduationYear" label="سنة التخرج">
            <div className="auth-control"><i className="fa-solid fa-calendar" /><input id="graduationYear" inputMode="numeric" dir="ltr" maxLength={4} value={f.graduationYear} onChange={set("graduationYear")} placeholder="2018" /></div>
          </Field>

          <Field id="postgraduate" label="الدراسات العليا أو الدورات التدريبية" optional wide hint="مثال: دبلوم تربوي، ماجستير، دورات ICDL، دورات طرق تدريس.">
            <textarea id="postgraduate" className="ts-textarea" rows={3} maxLength={500} value={f.postgraduate} onChange={set("postgraduate")} />
          </Field>

          <Field id="experience" label="عدد سنوات الخبرة">
            <div className="auth-control"><i className="fa-solid fa-briefcase" />
              <select id="experience" value={f.experience} onChange={set("experience")}>
                <option value="">اختار</option>
                {EXPERIENCE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </Field>

          <Field id="subjects" label="المادة / المواد اللي بتدرّسها">
            <div className="auth-control"><i className="fa-solid fa-chalkboard" /><input id="subjects" value={f.subjects} onChange={set("subjects")} maxLength={200} placeholder="افصل بين المواد بفاصلة، مثال: رياضيات، علوم" /></div>
          </Field>

          <Field id="workplaces" label="أماكن العمل السابقة" optional wide hint="أسماء المدارس أو المراكز التعليمية أو المنصات اللي اشتغلت فيها.">
            <textarea id="workplaces" className="ts-textarea" rows={3} maxLength={1000} value={f.workplaces} onChange={set("workplaces")} />
          </Field>

          <h2 className="ts-section-title"><i className="fa-solid fa-layer-group" /> المراحل التعليمية اللي بتغطيها</h2>

          <div className="ts-wide">
            <div className="ts-chips" role="group" aria-label="المراحل التعليمية">
              {STAGE_OPTIONS.map((s) => (
                <label key={s.value} className={`ts-chip${stages.includes(s.value) ? " on" : ""}`}>
                  <input type="checkbox" checked={stages.includes(s.value)} onChange={() => setStages((cur) => toggle(cur, s.value))} />
                  {s.label}
                </label>
              ))}
            </div>
            {/* لكل مرحلة مختارة (غير الجامعي) بيظهر بلوك الصفوف بتاعها: الأول/الثاني/الثالث... */}
            {STAGE_OPTIONS.filter((s) => stages.includes(s.value) && STAGE_GRADE_OPTIONS[s.value]).map((s) => (
              <div className="ts-sub" key={s.value}>
                <p className="ts-sub-title">صفوف {s.label} اللي بتدرّسها</p>
                <div className="ts-chips" role="group" aria-label={`صفوف ${s.label}`}>
                  {STAGE_GRADE_OPTIONS[s.value].map((g) => {
                    const on = stageGrades[s.value]?.includes(g.value) ?? false;
                    return (
                      <label key={g.value} className={`ts-chip${on ? " on" : ""}`}>
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() => setStageGrades((cur) => ({ ...cur, [s.value]: toggle(cur[s.value] ?? [], g.value) }))}
                        />
                        {g.label}
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          <h2 className="ts-section-title"><i className="fa-solid fa-paperclip" /> الملفات المطلوبة</h2>

          <Field id="cv" label="السيرة الذاتية (CV) بصيغة PDF" hint="PDF فقط، حد أقصى 5 ميجا.">
            <input id="cv" type="file" className="ts-file" accept="application/pdf,.pdf" onChange={onCvChange} />
            {cv && <p className="ts-picked"><i className="fa-solid fa-file-pdf" /> {cv.name} <small>({formatBytes(cv.size)})</small></p>}
            {cvErr && <p className="msg-error">{cvErr}</p>}
          </Field>

          <Field id="photo" label="صورة شخصية حديثة" hint="هتُستخدم في التعريف بيك وفي البوستات والإعلانات. JPG أو PNG أو WEBP، حد أقصى 3 ميجا.">
            <input id="photo" type="file" className="ts-file" accept="image/jpeg,image/png,image/webp" onChange={onPhotoChange} />
            {photoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="ts-photo-preview" src={photoUrl} alt="معاينة الصورة الشخصية" />
            )}
            {photoErr && <p className="msg-error">{photoErr}</p>}
          </Field>

          {!sessionEmail && (
            <>
              <h2 className="ts-section-title"><i className="fa-solid fa-lock" /> بيانات الدخول</h2>
              <Field id="password" label="كلمة السر">
                <div className="pw-wrap auth-control">
                  <i className="fa-solid fa-lock" />
                  <input id="password" type={showPw ? "text" : "password"} dir="ltr" value={f.password} onChange={set("password")} autoComplete="new-password" />
                  <button type="button" className="pw-toggle" onClick={() => setShowPw((s) => !s)}>{showPw ? "إخفاء" : "إظهار"}</button>
                </div>
              </Field>
              <Field id="confirm" label="تأكيد كلمة السر">
                <div className="auth-control"><i className="fa-solid fa-lock" /><input id="confirm" type={showPw ? "text" : "password"} dir="ltr" value={f.confirm} onChange={set("confirm")} autoComplete="new-password" placeholder="أعد كتابة كلمة السر" /></div>
              </Field>
              <p className="hint ts-wide">كلمة السر 8 حروف أو أرقام على الأقل.</p>
            </>
          )}

          <label className="ts-agree ts-wide">
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
            <span>أقرّ بصحة البيانات والمستندات المرفوعة، وأوافق على استخدامها في مراجعة طلبي والتواصل معي والتعريف بي على المنصة بعد الموافقة.</span>
          </label>

          {error && <p className="msg-error">{error}</p>}
          <button className="btn auth-submit" style={{ width: "100%" }} disabled={busy}>
            {busy ? "برجاء الانتظار..." : sessionEmail ? "إرسال الطلب" : "إنشاء الحساب وإرسال الطلب"}
          </button>
        </form>

        <p className="auth-foot">
          {sessionEmail ? <Link href="/dashboard">الرجوع لحسابي</Link> : <>عندك حساب؟ <Link href="/login?next=%2Fteacher-signup">سجّل الدخول</Link> · أنت طالب؟ <Link href="/signup">سجّل كطالب</Link></>}
        </p>
      </div>
    </div>
  );
}
