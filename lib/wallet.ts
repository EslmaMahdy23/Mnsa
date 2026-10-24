// رقم استقبال التحويلات اللي بيظهر للطالب. لو اتغيّر، غيّره من هنا بس.
export const PAYMENT_NUMBER = "0111111111";

// الحد الأدنى والأقصى لمبلغ طلب الشحن (نفس الأرقام اللي في الداتابيز)
export const MIN_TOPUP = 10;
export const MAX_TOPUP = 20000;

// سكرين التحويل: الصيغ المسموحة والحجم الأقصى (نفس إعدادات الباكت)
export const PROOF_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
export const MAX_PROOF_BYTES = 5 * 1024 * 1024;

export const TOPUP_STATUS: Record<string, string> = {
  pending: "قيد المراجعة",
  approved: "اتقبل",
  rejected: "اترفض",
};

export const fmtMoney = (n: number | string) => `${Number(n).toLocaleString("ar-EG")} جنيه`;
