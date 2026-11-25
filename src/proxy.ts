import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// Optimistic gate only: unauthenticated visitors never get the member area.
// The real enforcement is in the Convex functions, which re-check identity and role on every call.
const isMemberArea = createRouteMatcher(["/app(.*)"]);

export default clerkMiddleware(async (auth, req) => {
  if (isMemberArea(req)) await auth.protect();
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
