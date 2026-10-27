import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Runs before every page. Keeps the sign-in cookie fresh and sends signed-out visitors to /login.
// This is only the first gate; every page and every data call checks the user again (lib/auth.ts, lib/db.ts).
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const t0 = Date.now();
  const { data } = await supabase.auth.getClaims();
  if (Date.now() - t0 >= 300) console.warn(`[slow-auth] ${Date.now() - t0} ms getClaims ${request.nextUrl.pathname}`);
  const signedIn = Boolean(data?.claims?.sub);
  const onLogin = request.nextUrl.pathname === "/login";

  if (!signedIn && !onLogin) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  if (signedIn && onLogin) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|brand/|icon.png|favicon.ico|api/health).*)"],
};
