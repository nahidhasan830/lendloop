// Convex trusts JWTs issued by Clerk. Set CLERK_JWT_ISSUER_DOMAIN in the Convex
// deployment env (the "Frontend API URL" of your Clerk instance).
const authConfig = {
  providers: [
    {
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN,
      applicationID: "convex",
    },
  ],
};

export default authConfig;
