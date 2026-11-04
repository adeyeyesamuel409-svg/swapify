import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";

// Auth configuration: credentials are verified by the Swapify API
// (/auth/login), which returns a signed API access token. That token is stored
// in the NextAuth JWT and forwarded as `Authorization: Bearer` on API calls.
// The API_URL here is read at runtime on the Next.js server (internal route).
const API_URL = process.env.API_URL ?? "http://localhost:4000";

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "Email and password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;
        try {
          const res = await fetch(`${API_URL}/auth/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              email: credentials.email,
              password: credentials.password,
            }),
          });
          if (!res.ok) return null;
          const data = (await res.json()) as {
            token: string;
            user: { id: string; email: string; name: string };
          };
          return {
            id: data.user.id,
            email: data.user.email,
            name: data.user.name,
            accessToken: data.token,
          };
        } catch {
          return null;
        }
      },
    }),
  ],
  session: { strategy: "jwt" },
  pages: { signIn: "/signin" },
  secret: process.env.AUTH_SECRET,
  callbacks: {
    // Keep the API access token in the session so the app can call the Swapify API.
    async jwt({ token, user }) {
      if (user) {
        token.accessToken = user.accessToken;
      }
      return token;
    },
    async session({ session, token }) {
      session.accessToken = token.accessToken;
      if (session.user && token.sub) {
        (session.user as { id?: string }).id = token.sub;
      }
      return session;
    },
  },
};
