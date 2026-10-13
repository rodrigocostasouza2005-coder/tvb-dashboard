import { describe, it, expect, vi, beforeEach } from "vitest";
import { extrairFoto } from "../meta-ads";

describe("extrairFoto — prioridade e fallback de imagem do criativo", () => {
  it("usa thumbnail_url quando presente (caso comum: imagem, vídeo, Reels, carrossel dinâmico)", () => {
    expect(extrairFoto({ thumbnail_url: "https://fbcdn.net/thumb.jpg" })).toBe("https://fbcdn.net/thumb.jpg");
  });

  it("cai pro video_data.image_url quando thumbnail_url não vem (post de vídeo/Reels)", () => {
    expect(
      extrairFoto({ object_story_spec: { video_data: { image_url: "https://fbcdn.net/video-thumb.jpg" } } })
    ).toBe("https://fbcdn.net/video-thumb.jpg");
  });

  it("cai pro link_data.picture quando não há thumbnail nem vídeo (anúncio de link legado)", () => {
    expect(extrairFoto({ object_story_spec: { link_data: { picture: "https://fbcdn.net/link.jpg" } } })).toBe(
      "https://fbcdn.net/link.jpg"
    );
  });

  it("cai pra primeira imagem válida de asset_feed_spec (carrossel dinâmico/Advantage+)", () => {
    expect(
      extrairFoto({ asset_feed_spec: { images: [{ url: undefined }, { url: "https://fbcdn.net/asset1.jpg" }] } })
    ).toBe("https://fbcdn.net/asset1.jpg");
  });

  it("retorna undefined quando a resposta não tem nenhum campo de imagem (nunca inventa foto)", () => {
    expect(extrairFoto({})).toBeUndefined();
    expect(extrairFoto(undefined)).toBeUndefined();
  });

  it("não descarta uma imagem válida só porque outro campo alternativo está vazio", () => {
    expect(
      extrairFoto({
        object_story_spec: { video_data: {}, link_data: {} },
        asset_feed_spec: { images: [{}, { url: "https://fbcdn.net/ok.jpg" }] },
      })
    ).toBe("https://fbcdn.net/ok.jpg");
  });
});

const findUnique = vi.fn();
const upsert = vi.fn();
function mockPrisma() {
  return { priceCatalogCache: { findUnique, upsert } } as never;
}

describe("getFotosPorNomeAnuncio — não zera fotos já cacheadas quando o Top 15 muda", () => {
  beforeEach(() => {
    findUnique.mockReset();
    upsert.mockReset();
    vi.stubGlobal("fetch", vi.fn());
    process.env.META_AD_ACCOUNT_ID = "123";
    process.env.META_ACCESS_TOKEN = "token-fake";
  });

  it("caso real 2026-10-13: ranking muda (1 criativo novo entra), os outros 2 já cacheados mantêm a foto", async () => {
    // Cache existente: "A" e "B" já têm foto boa de uma busca anterior; fresco (dentro de 12h).
    findUnique.mockImplementation(({ where }: { where: { clientLabel: string } }) => {
      if (where.clientLabel === "meta-ads-fotos-criativo") {
        return Promise.resolve({
          data: { A: ["https://fbcdn.net/a.jpg"], B: ["https://fbcdn.net/b.jpg"] },
          updatedAt: new Date(), // agora mesmo -> isFresh = true
        });
      }
      // lista crua de anúncios (fetchTodosAnunciosCached) — também "fresca", sem nova busca à API.
      return Promise.resolve({
        data: [
          { id: "id-a", name: "A", status: "ACTIVE" },
          { id: "id-b", name: "B", status: "ACTIVE" },
          { id: "id-c", name: "C", status: "ACTIVE" },
        ],
        updatedAt: new Date(),
      });
    });

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({
      json: () => Promise.resolve({ creative: { thumbnail_url: "https://fbcdn.net/c.jpg" } }),
    });

    const { getFotosPorNomeAnuncio } = await import("../meta-ads");
    // "C" é novo no Top 15 desta chamada (não estava em A/B do cache) — só ele devia gerar uma
    // chamada de rede; A e B não podem ser tocados.
    const result = await getFotosPorNomeAnuncio(mockPrisma(), ["A", "B", "C"]);

    expect(result.get("A")).toEqual(["https://fbcdn.net/a.jpg"]);
    expect(result.get("B")).toEqual(["https://fbcdn.net/b.jpg"]);
    expect(result.get("C")).toEqual(["https://fbcdn.net/c.jpg"]);

    // Só 1 chamada de rede (pro "C"), nunca refaz A/B que já estavam cacheados e frescos.
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // O que foi persistido no cache preserva A/B, nunca grava [] por cima deles.
    const persisted = upsert.mock.calls.find((c) => c[0].where.clientLabel === "meta-ads-fotos-criativo")?.[0];
    expect(persisted.update.data.A).toEqual(["https://fbcdn.net/a.jpg"]);
    expect(persisted.update.data.B).toEqual(["https://fbcdn.net/b.jpg"]);
    expect(persisted.update.data.C).toEqual(["https://fbcdn.net/c.jpg"]);
  });

  it("não cria associação errada: cada nome só recebe a foto do seu próprio id", async () => {
    findUnique.mockImplementation(({ where }: { where: { clientLabel: string } }) => {
      if (where.clientLabel === "meta-ads-fotos-criativo") return Promise.resolve(null);
      return Promise.resolve({
        data: [
          { id: "id-x", name: "X", status: "ACTIVE" },
          { id: "id-y", name: "Y", status: "ACTIVE" },
        ],
        updatedAt: new Date(),
      });
    });

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockImplementation((url: string) => {
      const foto = url.includes("id-x") ? "https://fbcdn.net/x.jpg" : "https://fbcdn.net/y.jpg";
      return Promise.resolve({ json: () => Promise.resolve({ creative: { thumbnail_url: foto } }) });
    });

    const { getFotosPorNomeAnuncio } = await import("../meta-ads");
    const result = await getFotosPorNomeAnuncio(mockPrisma(), ["X", "Y"]);

    expect(result.get("X")).toEqual(["https://fbcdn.net/x.jpg"]);
    expect(result.get("Y")).toEqual(["https://fbcdn.net/y.jpg"]);
  });
});
