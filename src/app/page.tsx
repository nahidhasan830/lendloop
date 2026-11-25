"use client";

import { SignInButton, SignUpButton, UserButton } from "@clerk/nextjs";
import { Authenticated, AuthLoading, Unauthenticated, useQuery } from "convex/react";
import Link from "next/link";
import { api } from "../../convex/_generated/api";
import { Badge, btn, btnGhost } from "@/components/ui";

export default function Home() {
  const tools = useQuery(api.tools.listPublic, {});
  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">LendLoop</h1>
        <nav className="flex items-center gap-2">
          <AuthLoading><span className="text-sm text-stone-500">…</span></AuthLoading>
          <Unauthenticated>
            <SignInButton mode="modal"><button className={btnGhost}>Sign in</button></SignInButton>
            <SignUpButton mode="modal"><button className={btn}>Join</button></SignUpButton>
          </Unauthenticated>
          <Authenticated>
            <Link href="/app" className={btn}>Open my account</Link>
            <UserButton />
          </Authenticated>
        </nav>
      </header>

      <section className="py-10">
        <h2 className="text-3xl font-semibold">Borrow a drill. Skip buying one.</h2>
        <p className="mt-2 max-w-xl text-stone-600">
          A small tool library for neighbours. Browse what is on the shelf, join to ask for a loan, and lend out what you
          are not using.
        </p>
        <p className="mt-2 text-sm text-stone-500">
          Privacy: visitors see only a tool&apos;s name, category and availability. Descriptions and conditions are for members, and
          nobody sees who owns what unless they are part of a loan.
        </p>
      </section>

      <section aria-labelledby="shelf">
        <h3 id="shelf" className="mb-3 text-lg font-semibold">On the shelf</h3>
        {tools === undefined ? (
          <p className="text-stone-500">Loading…</p>
        ) : tools.length === 0 ? (
          <p className="text-stone-500">Nothing listed yet. Be the first to share a tool.</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {tools.map((t) => (
              <li key={t._id} className="flex items-center justify-between rounded-lg border border-stone-200 bg-white p-3">
                <div>
                  <p className="font-medium">{t.name}</p>
                  <p className="text-sm capitalize text-stone-500">{t.category}</p>
                </div>
                <Badge tone={t.available ? "green" : "amber"}>{t.available ? "Available" : "On loan"}</Badge>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
