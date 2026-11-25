"use client";

import { UserButton } from "@clerk/nextjs";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "../../../convex/_generated/api";
import Browse from "@/components/Browse";
import MyTools from "@/components/MyTools";
import Loans from "@/components/Loans";
import Admin from "@/components/Admin";
import { Badge } from "@/components/ui";

type Tab = "browse" | "tools" | "loans" | "admin";

export default function MemberArea() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const store = useMutation(api.users.store);
  const me = useQuery(api.users.me, isAuthenticated ? {} : "skip");
  const [tab, setTab] = useState<Tab>("browse");

  // Create (or refresh) the member profile once Convex has accepted the Clerk token.
  useEffect(() => {
    if (isAuthenticated) void store({});
  }, [isAuthenticated, store]);

  if (isLoading || !isAuthenticated || !me) return <p className="p-8 text-stone-500">Loading your account…</p>;

  const tabs: [Tab, string][] = [["browse", "Browse"], ["tools", "My tools"], ["loans", "Loans"]];
  if (me.role === "admin") tabs.push(["admin", "Admin"]);

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-6">
      <header className="mb-4 flex items-center justify-between">
        <Link href="/" className="text-xl font-bold">LendLoop</Link>
        <div className="flex items-center gap-3">
          <span className="text-sm text-stone-600">{me.name}</span>
          {me.role === "admin" && <Badge tone="blue">Admin</Badge>}
          {me.trustedLender && <Badge tone="green">Trusted Lender</Badge>}
          <UserButton />
        </div>
      </header>
      <nav className="mb-6 flex gap-1 border-b border-stone-200" role="tablist">
        {tabs.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
            className={`px-3 py-2 text-sm font-medium ${tab === id ? "border-b-2 border-stone-900" : "text-stone-500 hover:text-stone-900"}`}>
            {label}
          </button>
        ))}
      </nav>
      {tab === "browse" && <Browse />}
      {tab === "tools" && <MyTools />}
      {tab === "loans" && <Loans />}
      {tab === "admin" && me.role === "admin" && <Admin />}
    </main>
  );
}
