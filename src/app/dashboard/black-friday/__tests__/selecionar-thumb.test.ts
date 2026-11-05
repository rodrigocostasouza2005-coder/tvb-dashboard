import { describe, it, expect } from "vitest";
import { selecionarThumb } from "../selecionar-thumb";

describe("selecionarThumb — qual foto mostrar como thumb da tabela Por Anúncio", () => {
  it("sem fotos (array vazio): sem thumb, sem extra", () => {
    expect(selecionarThumb([])).toEqual({ thumb: undefined, extras: 0 });
  });

  it("fotos undefined (Map.get sem entrada pro nome): sem thumb, sem extra", () => {
    expect(selecionarThumb(undefined)).toEqual({ thumb: undefined, extras: 0 });
  });

  it("uma foto só: ela é a thumb, zero extras (sem badge +N)", () => {
    expect(selecionarThumb(["https://fbcdn.net/a.jpg"])).toEqual({ thumb: "https://fbcdn.net/a.jpg", extras: 0 });
  });

  it("várias fotos: a primeira é a thumb, o resto conta como extra pro badge +N", () => {
    const fotos = ["https://fbcdn.net/a.jpg", "https://fbcdn.net/b.jpg", "https://fbcdn.net/c.jpg"];
    expect(selecionarThumb(fotos)).toEqual({ thumb: "https://fbcdn.net/a.jpg", extras: 2 });
  });
});
