import { performance } from "node:perf_hooks";

function readArg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? fallback : process.argv[index + 1];
}

const base = readArg("url", "http://localhost:3000");
const users = Number(readArg("users", "100"));
const mode = readArg("mode", "burst");
const seconds = Number(readArg("seconds", "30"));
const rps = Number(readArg("rps", "20"));
const paths = (readArg("paths", "/") || "/").split(",").map((p) => p.trim()).filter(Boolean);

let target;
try {
  target = new URL(base);
} catch {
  console.error("URL غير صالح. استخدم --url http://localhost:3000");
  process.exit(1);
}
if (!["http:", "https:"].includes(target.protocol)) {
  console.error("استخدم عنوان HTTP أو HTTPS.");
  process.exit(1);
}
if (!Number.isInteger(users) || users < 1 || users > 100) {
  console.error("عدد المستخدمين لازم يكون من 1 إلى 100.");
  process.exit(1);
}
if (!["burst", "steady"].includes(mode)) {
  console.error("الوضع لازم يكون burst أو steady.");
  process.exit(1);
}
if (!Number.isInteger(seconds) || seconds < 1 || seconds > 300) {
  console.error("مدة الاختبار لازم تكون من 1 إلى 300 ثانية.");
  process.exit(1);
}
if (!Number.isInteger(rps) || rps < 1 || rps > 100) {
  console.error("معدل الطلبات لازم يكون من 1 إلى 100 طلب/ثانية.");
  process.exit(1);
}
if (paths.some((path) => !path.startsWith("/") || path.startsWith("//"))) {
  console.error("كل المسارات لازم تبدأ بـ / وتكون داخل نفس الموقع.");
  process.exit(1);
}

const host = target.hostname.toLowerCase();
const local = host === "localhost" || host === "127.0.0.1" || host === "::1";
if (!local && !process.argv.includes("--allow-public-target")) {
  console.error("للاختبار على موقع منشور، أضف --allow-public-target بعد التأكد إنك تملكه أو عندك إذن تختبره.");
  process.exit(1);
}

const deadline = performance.now() + seconds * 1000;
const samples = [];
let errors = 0;
const networkErrors = new Map();
let nextRequestAt = performance.now();
let cursor = 0;
let readyUsers = 0;
let releaseStart;
const startGate = new Promise((resolve) => { releaseStart = resolve; });

async function takeRequestSlot() {
  const now = performance.now();
  const slot = Math.max(now, nextRequestAt);
  nextRequestAt = slot + 1000 / rps;
  const delay = slot - now;
  if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
}

async function requestPath(path) {
  const url = new URL(path, target);
  const started = performance.now();
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(15000),
      headers: { "user-agent": "mnsa-load-check/1.0" },
    });
    await response.arrayBuffer();
    samples.push({ ms: performance.now() - started, status: response.status });
    if (response.status >= 400) errors++;
  } catch (error) {
    errors++;
    samples.push({ ms: performance.now() - started, status: 0 });
    const cause = error?.cause;
    const label = cause?.code ? `${cause.code}: ${cause.message || error.message}` : (error?.message || String(error));
    networkErrors.set(label, (networkErrors.get(label) || 0) + 1);
  }
}

async function burstUser() {
  readyUsers++;
  if (readyUsers === users) releaseStart();
  await startGate;
  // Each virtual user requests every selected page at the same time.
  await Promise.all(paths.map(requestPath));
}

async function steadyUser() {
  while (performance.now() < deadline) {
    await takeRequestSlot();
    if (performance.now() >= deadline) break;
    const path = paths[cursor++ % paths.length];
    await requestPath(path);
  }
}

console.log(mode === "burst"
  ? `اختبار دفعة متزامنة على ${target.origin} | ${users} مستخدم | ${paths.length} صفحة لكل مستخدم`
  : `اختبار مستمر على ${target.origin} | ${users} مستخدم | ${seconds} ثانية | بحد أقصى ${rps} طلب/ثانية`);
if (mode === "burst") {
  await Promise.all(Array.from({ length: users }, () => burstUser()));
} else {
  await Promise.all(Array.from({ length: users }, () => steadyUser()));
}

const times = samples.map((sample) => sample.ms).sort((a, b) => a - b);
const percentile = (p) => times.length ? times[Math.min(times.length - 1, Math.ceil(times.length * p) - 1)] : 0;
const statusCounts = new Map();
for (const sample of samples) {
  const label = sample.status === 0 ? "network/timeout" : String(sample.status);
  statusCounts.set(label, (statusCounts.get(label) || 0) + 1);
}

console.log("\nالنتيجة:");
console.log(`الطلبات: ${samples.length} | أخطاء (HTTP 4xx/5xx أو اتصال): ${errors}`);
console.log(`الاستجابة: متوسط ${times.length ? (times.reduce((a, b) => a + b, 0) / times.length).toFixed(0) : 0}ms | p95 ${percentile(0.95).toFixed(0)}ms | أقصى ${percentile(1).toFixed(0)}ms`);
console.log(`الحالات: ${[...statusCounts].map(([status, count]) => `${status}=${count}`).join(", ") || "لا توجد طلبات"}`);
if (networkErrors.size) {
  console.log("أسباب فشل الاتصال:");
  for (const [reason, count] of [...networkErrors].sort((a, b) => b[1] - a[1]).slice(0, 5)) {
    console.log(`- ${count} × ${reason}`);
  }
}
console.log("الاختبار يطلب صفحات GET فقط؛ لا ينشئ حسابات أو يغيّر بيانات. كل صفحة محسوبة كطلب مستقل.");
