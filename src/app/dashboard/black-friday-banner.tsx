import Image from "next/image";
import { getBannerStatus } from "@/lib/black-friday-banner";

// Faixa promocional fixa, logo abaixo do header/nav (ver dashboard/layout.tsx), em TODAS as
// páginas do dashboard — componente único, sem duplicação por página. Visibilidade decidida
// 100% no servidor (getBannerStatus() resolve janela automática + override manual via DB) —
// nunca confia no relógio local do navegador pra decidir se mostra ou não.
//
// Animação é só CSS (@keyframes bf-marquee em globals.css) — sem "use client", sem JS no
// cliente pra rodar o marquee, só a trilha duplicada (REPETICOES) correndo em loop.
const TEXTO = "É BLACK FRIDAYYYYYYY!!!!!!!";
const REPETICOES = 6;

function Trilha() {
  return (
    <div className="flex shrink-0 items-center" aria-hidden>
      {Array.from({ length: REPETICOES }).map((_, i) => (
        <div key={i} className="flex shrink-0 items-center gap-3 px-4 sm:gap-4 sm:px-6">
          <Image
            src="/tvb-logo.png"
            alt=""
            width={28}
            height={22}
            className="h-6 w-auto shrink-0 sm:h-7"
            style={{ filter: "brightness(0) invert(1)" }}
          />
          <span className="whitespace-nowrap text-sm font-bold tracking-wide text-white uppercase sm:text-base">
            {TEXTO}
          </span>
        </div>
      ))}
    </div>
  );
}

export async function BlackFridayBanner() {
  const { visible } = await getBannerStatus();
  if (!visible) return null;

  return (
    <div
      role="banner"
      aria-label="Promoção Black Friday"
      className="flex h-12 items-center overflow-hidden sm:h-[54px]"
      style={{ backgroundColor: "#d1121b" }}
    >
      <div className="flex w-max" style={{ animation: "bf-marquee 22s linear infinite" }}>
        <Trilha />
        <Trilha />
      </div>
    </div>
  );
}
