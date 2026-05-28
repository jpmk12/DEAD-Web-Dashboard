import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth.config";

const { auth } = NextAuth(authConfig);
export default auth;

export const config = {
  matcher: ["/((?!api/auth|api/diag|_next/static|_next/image|favicon.ico).*)"],
};
