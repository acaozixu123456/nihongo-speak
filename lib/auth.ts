export const AUTH_COOKIE = "ns_auth";

// The cookie holds a hash of the password, so changing APP_PASSWORD logs every device out.
export async function authToken(password: string) {
  const data = new TextEncoder().encode(`nihongo-speak:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
