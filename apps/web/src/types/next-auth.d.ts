import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface User {
    accessToken?: string;
  }
  interface Session {
    accessToken?: string;
    idToken?: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    accessToken?: string;
    idToken?: string;
  }
}
