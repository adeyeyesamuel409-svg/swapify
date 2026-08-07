"use client";

import Link from "next/link";
import { signIn, signOut, useSession } from "next-auth/react";
import NotificationBell from "./NotificationBell";

export default function AuthControls() {
  const { data: session } = useSession();

  if (session?.user) {
    return (
      <div className="flex items-center gap-4">
        <p className="text-sm text-gray-300">
          Signed in as <span className="font-semibold text-white">{session.user.email}</span>
        </p>
        <NotificationBell />
        <Link
          href="/wallet"
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
        >
          My wallet
        </Link>
        <Link
          href="/tokens"
          className="rounded-md border border-indigo-500 px-4 py-2 text-sm font-semibold text-indigo-200 hover:bg-indigo-900"
        >
          Buy tokens
        </Link>
        <Link
          href="/swaps"
          className="rounded-md border border-indigo-500 px-4 py-2 text-sm font-semibold text-indigo-200 hover:bg-indigo-900"
        >
          My swaps
        </Link>
        <Link
          href="/wishlists"
          className="rounded-md border border-gray-600 px-4 py-2 text-sm font-semibold text-gray-200 hover:bg-gray-700"
        >
          Wishlists
        </Link>
        <Link
          href="/profile"
          className="rounded-md border border-gray-600 px-4 py-2 text-sm font-semibold text-gray-200 hover:bg-gray-700"
        >
          My profile
        </Link>
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
