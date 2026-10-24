// القيمة اللي بتتخزّن في الداتابيز: ابتدائي 1-6، إعدادي 7-9 (7 = أولى إعدادي)
export const GRADES = [
  { value: 1, label: "الصف الأول الابتدائي" },
  { value: 2, label: "الصف الثاني الابتدائي" },
  { value: 3, label: "الصف الثالث الابتدائي" },
  { value: 4, label: "الصف الرابع الابتدائي" },
  { value: 5, label: "الصف الخامس الابتدائي" },
  { value: 6, label: "الصف السادس الابتدائي" },
  { value: 7, label: "الصف الأول الإعدادي" },
  { value: 8, label: "الصف الثاني الإعدادي" },
  { value: 9, label: "الصف الثالث الإعدادي" },
];

// يحوّل الأرقام العربية (٠١٢...) لإنجليزي
export const toEnDigits = (s: string) =>
  s.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));

// يشيل المسافات والشرطات
export const cleanPhone = (s: string) => toEnDigits(s).replace(/[\s-]/g, "");

// موبايل مصري: 010 / 011 / 012 / 015 + 8 أرقام
export const isEgPhone = (s: string) => /^01[0125]\d{8}$/.test(s);
