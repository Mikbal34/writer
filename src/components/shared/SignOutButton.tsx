"use client";

import { signOut } from "next-auth/react";
import { LogOut } from "lucide-react";

export default function SignOutButton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <button
      onClick={() => signOut({ callbackUrl: "/" })}
      className={className}
      style={style}
    >
      <LogOut className="h-3.5 w-3.5" />
      <span className="hidden sm:block">Sign Out</span>
    </button>
  );
}
