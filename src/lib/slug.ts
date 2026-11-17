/** Auto-generates a URL slug from a hospital name ("عين شمس" → "ain-shams"). */

const AR_MAP: Record<string, string> = {
  ا: "a", أ: "a", إ: "a", آ: "a", ٱ: "a",
  ب: "b", ت: "t", ث: "th", ج: "j", ح: "h", خ: "kh",
  د: "d", ذ: "dh", ر: "r", ز: "z", س: "s", ش: "sh",
  ص: "s", ض: "d", ط: "t", ظ: "z", ع: "a", غ: "gh",
  ف: "f", ق: "q", ك: "k", ل: "l", م: "m", ن: "n",
  ه: "h", ة: "h", و: "w", ؤ: "w", ي: "y", ى: "y", ئ: "y", ء: "a",
};

export function slugifyName(name: string): string {
  const translit = [...(name ?? "")]
    .map((ch) => {
      const lower = ch.toLowerCase();
      if (AR_MAP[ch] ?? AR_MAP[lower]) return AR_MAP[ch] ?? AR_MAP[lower];
      if (/[a-z0-9]/.test(lower)) return lower;
      return " ";
    })
    .join("");
  const slug = translit.replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return slug.slice(0, 40) || "hospital";
}
