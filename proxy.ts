import {
  convexAuthNextjsMiddleware,
  nextjsMiddlewareRedirect,
} from "@convex-dev/auth/nextjs/server";
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import { loginRedirect } from "./lib/loginRedirect";

// Everything except the sign-in page requires the owner to be logged in. The wrapper refreshes
// the token first, so getToken sees the fresh one; the redirect itself is decided locally.
const auth = convexAuthNextjsMiddleware(
  async (request, { convexAuth }) => {
    const to = loginRedirect(request.nextUrl.pathname, await convexAuth.getToken(), Date.now());
    if (to) return nextjsMiddlewareRedirect(request, to);
  },
  // The browser reaches Convex at its public URL (baked into the build); this server may need a
  // different address, e.g. the backend's name inside Docker (phase 5). Read at runtime.
  { convexUrl: process.env.CONVEX_URL_INTERNAL ?? process.env.NEXT_PUBLIC_CONVEX_URL },
);

// When convex-auth also rewrites the auth cookies (a refresh, or a failed one clearing them), it
// wraps our redirect in NextResponse.next(), so the page renders blank instead of redirecting.
// Turn that back into a real redirect, keeping the cookies.
export default async function proxy(request: NextRequest, event: NextFetchEvent) {
  const response = await auth(request, event);
  const location = response?.headers.get("location");
  if (!location || response?.status !== 200) return response;
  const redirect = NextResponse.redirect(new URL(location, request.url));
  for (const cookie of response.headers.getSetCookie()) redirect.headers.append("set-cookie", cookie);
  return redirect;
}

export const config = {
  // The following matcher runs middleware on all routes
  // except static assets.
  matcher: ["/((?!.*\\..*|_next).*)", "/", "/(api|trpc)(.*)"],
};
