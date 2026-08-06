"use client";

import { signIn, signOut, useSession } from "next-auth/react";

export default function AuthControls() {
  const { data: session } = useSession();

  if (session?.user) {
    return (
      <div className="flex items-center gap-4">
        <p className="text-sm text-gray-300">
          Signed in as <span className="font-semibold text-white">{session.user.email}</span>
        </p>
        <a
          href="/profile"
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
        >
          My profile
        </a>
        <button
          onClick={() => signOut()}
          className="rounded-md border border-gray-600 px-4 py-2 text-sm font-semibold text-gray-200 hover:bg-gray-700"
        >
          Sign out
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => signIn("cognito")}
      className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
    >
      Sign in / Sign up
    </button>
  );
}
