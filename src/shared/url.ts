// URLはhashを除去しqueryを維持して正規化する。SPAでpathnameまたはquery
// が変わった場合は別URLとして扱う（凍結設計どおり）。
export function canonicalUrlOf(input: string): string | null {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  url.hash = "";
  url.username = "";
  url.password = "";
  return url.toString();
}

export function originOf(input: string): string | null {
  try {
    const url = new URL(input);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}
