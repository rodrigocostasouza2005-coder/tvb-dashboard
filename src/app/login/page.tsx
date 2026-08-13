"use client";

import Image from "next/image";
import { useActionState } from "react";
import { loginAction, type LoginState } from "./actions";

const initialState: LoginState = {};

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(loginAction, initialState);

  return (
    <main className="flex min-h-screen bg-[#f9f9f7]">
      <div className="relative hidden w-1/2 lg:block">
        <Image
          src="/login-photo.jpg"
          alt="TVB Shorts"
          fill
          priority
          className="object-cover"
          sizes="50vw"
        />
        <div
          className="absolute inset-0"
          style={{ background: "linear-gradient(0deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0) 45%)" }}
        />
        <div className="absolute bottom-0 left-0 p-10 text-white">
          <div className="text-3xl font-semibold tracking-tight">TVB Radar</div>
          <div className="mt-1 text-sm text-white/80">Acompanhe vendas, estoque e sell-through da TVB Shorts em tempo real</div>
        </div>
      </div>

      <div className="flex flex-1 items-center justify-center px-4 py-12">
        <form
          action={formAction}
          className="w-full max-w-sm rounded-xl border border-black/10 bg-[#fcfcfb] p-8 shadow-sm"
        >
          <h1 className="mb-1 text-xl font-semibold text-[#0b0b0b]">TVB Radar</h1>
          <p className="mb-6 text-sm text-[#52514e]">TVB Shorts · Entrar no TVB Radar</p>

          <label className="mb-1 block text-sm font-medium text-[#0b0b0b]" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            className="mb-4 w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm text-[#0b0b0b] outline-none focus:border-[#2a78d6]"
            style={{ colorScheme: "light" }}
          />

          <label className="mb-1 block text-sm font-medium text-[#0b0b0b]" htmlFor="password">
            Senha
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            className="mb-4 w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm text-[#0b0b0b] outline-none focus:border-[#2a78d6]"
            style={{ colorScheme: "light" }}
          />

          {state.error && (
            <p className="mb-4 text-sm text-[#d03b3b]">{state.error}</p>
          )}

          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-md bg-[#2a78d6] px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {pending ? "Entrando…" : "Entrar"}
          </button>
        </form>
      </div>
    </main>
  );
}
