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

  it("bug de colisão de nome (missão Black Friday 2026-11-05): dois ANÚNCIOS diferentes (ids distintos) com o MESMO nome não podem se sobrescrever — foto final é a união das duas", async () => {
    findUnique.mockImplementation(({ where }: { where: { clientLabel: string } }) => {
      if (where.clientLabel === "meta-ads-fotos-criativo") return Promise.resolve(null);
      // Dois anúncios reais, ids diferentes, nome IGUAL — cenário real (campanha reaproveitando
      // nome de criativo, ou nome genérico tipo "Anúncio 1").
      return Promise.resolve({
        data: [
          { id: "id-dup-1", name: "Mesmo Nome", status: "ACTIVE" },
          { id: "id-dup-2", name: "Mesmo Nome", status: "PAUSED" },
        ],
        updatedAt: new Date(),
      });
    });

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockImplementation((url: string) => {
      const foto = url.includes("id-dup-1") ? "https://fbcdn.net/dup1.jpg" : "https://fbcdn.net/dup2.jpg";
      return Promise.resolve({ json: () => Promise.resolve({ creative: { thumbnail_url: foto } }) });
    });

    const { getFotosPorNomeAnuncio } = await import("../meta-ads");
    const result = await getFotosPorNomeAnuncio(mockPrisma(), ["Mesmo Nome"]);

    // Antes da correção, só a foto do PRIMEIRO id ficava (ou nenhuma, dependendo da ordem) — a
    // versão corrigida nunca perde nenhuma das duas veiculações legítimas por causa do nome igual.
    expect(result.get("Mesmo Nome")).toEqual(
      expect.arrayContaining(["https://fbcdn.net/dup1.jpg", "https://fbcdn.net/dup2.jpg"])
    );
    expect(result.get("Mesmo Nome")).toHaveLength(2);
  });
});

describe("getStatusPorNomeConjunto / getStatusPorNomeAnuncio — colisão de nome não perde status ativo", () => {
  beforeEach(() => {
    findUnique.mockReset();
    upsert.mockReset();
    vi.stubGlobal("fetch", vi.fn());
    process.env.META_AD_ACCOUNT_ID = "123";
    process.env.META_ACCESS_TOKEN = "token-fake";
  });

  it("dois CONJUNTOS com o mesmo nome, um ACTIVE e outro PAUSED — status reportado é ativo (nenhuma veiculação real é escondida)", async () => {
    findUnique.mockResolvedValue({
      data: [
        { id: "id1", name: "Conjunto X", status: "PAUSED" },
        { id: "id2", name: "Conjunto X", status: "ACTIVE" },
      ],
      updatedAt: new Date(),
    });

    const { getStatusPorNomeConjunto } = await import("../meta-ads");
    const result = await getStatusPorNomeConjunto(mockPrisma(), ["Conjunto X"]);

    expect(result.get("Conjunto X")).toBe(true);
  });

  it("dois ANÚNCIOS com o mesmo nome, ambos PAUSED — status reportado é pausado (não inventa ativo)", async () => {
    findUnique.mockResolvedValue({
      data: [
        { id: "id1", name: "Anúncio Y", status: "PAUSED" },
        { id: "id2", name: "Anúncio Y", status: "PAUSED" },
      ],
      updatedAt: new Date(),
    });

    const { getStatusPorNomeAnuncio } = await import("../meta-ads");
    const result = await getStatusPorNomeAnuncio(mockPrisma(), ["Anúncio Y"]);

    expect(result.get("Anúncio Y")).toBe(false);
  });
});

describe("getFotosPorNomeConjunto — colisão de nome não perde foto de nenhum conjunto", () => {
  beforeEach(() => {
    findUnique.mockReset();
    upsert.mockReset();
    vi.stubGlobal("fetch", vi.fn());
    process.env.META_AD_ACCOUNT_ID = "123";
    process.env.META_ACCESS_TOKEN = "token-fake";
  });

  it("dois conjuntos (ids diferentes) com o mesmo nome — fotos das duas veiculações aparecem, nenhuma é descartada", async () => {
    findUnique.mockImplementation(({ where }: { where: { clientLabel: string } }) => {
      if (where.clientLabel === "meta-ads-fotos") return Promise.resolve(null);
      // meta-ads-adsets-raw: dois conjuntos reais, ids diferentes, nome igual.
      return Promise.resolve({
        data: [
          { id: "id1", name: "Conjunto X", status: "ACTIVE" },
          { id: "id2", name: "Conjunto X", status: "ACTIVE" },
        ],
        updatedAt: new Date(),
      });
    });

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockImplementation((url: string) => {
      if (url.includes("/id1/ads")) {
        return Promise.resolve({
          json: () =>
            Promise.resolve({ data: [{ id: "ad1", status: "ACTIVE", creative: { thumbnail_url: "https://fbcdn.net/x1.jpg" } }] }),
        });
      }
      return Promise.resolve({
        json: () =>
          Promise.resolve({ data: [{ id: "ad2", status: "ACTIVE", creative: { thumbnail_url: "https://fbcdn.net/x2.jpg" } }] }),
      });
    });

    const { getFotosPorNomeConjunto } = await import("../meta-ads");
    const result = await getFotosPorNomeConjunto(mockPrisma(), ["Conjunto X"]);

    expect(result.get("Conjunto X")).toEqual(
      expect.arrayContaining(["https://fbcdn.net/x1.jpg", "https://fbcdn.net/x2.jpg"])
    );
    expect(result.get("Conjunto X")).toHaveLength(2);
  });
});

describe("getInsightsPorConjunto / getInsightsPorAnuncio — identidade por id, nunca por nome", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    process.env.META_AD_ACCOUNT_ID = "123";
    process.env.META_ACCESS_TOKEN = "token-fake";
  });

  it("bug de colisão de nome (missão Black Friday 2026-11-05): dois CONJUNTOS reais (adset_id diferente) com o mesmo adset_name são SOMADOS corretamente, nunca um sobrescreve o outro", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({
      json: () =>
        Promise.resolve({
          data: [
            {
              adset_id: "id1",
              adset_name: "Promo BF",
              spend: "100",
              impressions: "1000",
              reach: "900",
              clicks: "20",
              actions: [{ action_type: "purchase", value: "2" }],
              purchase_roas: [{ action_type: "omni_purchase", value: "3" }],
            },
            {
              adset_id: "id2",
              adset_name: "Promo BF",
              spend: "50",
              impressions: "500",
              reach: "450",
              clicks: "10",
              actions: [{ action_type: "purchase", value: "1" }],
              purchase_roas: [{ action_type: "omni_purchase", value: "2" }],
            },
          ],
        }),
    });

    const { getInsightsPorConjunto } = await import("../meta-ads");
    const result = await getInsightsPorConjunto({ since: "2026-11-01", until: "2026-11-05" });

    expect(result.size).toBe(1); // um nome só no retorno (ponte GA4), mas com os dois somados
    const insight = result.get("Promo BF")!;
    expect(insight.gasto).toBe(150);
    expect(insight.impressoes).toBe(1500);
    expect(insight.alcance).toBe(1350);
    expect(insight.cliques).toBe(30);
    expect(insight.compras).toBe(3);
    expect(insight.ctrPct).toBeCloseTo((30 / 1500) * 100, 5);
    expect(insight.cpc).toBeCloseTo(150 / 30, 5);
    expect(insight.cpm).toBeCloseTo((150 / 1500) * 1000, 5);
    expect(insight.custoPorCompra).toBeCloseTo(150 / 3, 5);
    // receita total = 3*100 + 2*50 = 400 -> roas agregado = 400/150, não a média simples (2.5) nem
    // um dos dois ratios escolhido arbitrariamente.
    expect(insight.roas).toBeCloseTo(400 / 150, 5);
  });

  it("mesma colisão, mas nível ANÚNCIO (ad_id/ad_name) — soma correta, não overwrite", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({
      json: () =>
        Promise.resolve({
          data: [
            {
              ad_id: "ad1",
              ad_name: "Criativo Genérico",
              spend: "40",
              impressions: "400",
              reach: "380",
              clicks: "8",
              actions: [{ action_type: "purchase", value: "1" }],
              purchase_roas: [{ action_type: "omni_purchase", value: "4" }],
            },
            {
              ad_id: "ad2",
              ad_name: "Criativo Genérico",
              spend: "60",
              impressions: "600",
              reach: "550",
              clicks: "12",
              actions: [{ action_type: "purchase", value: "2" }],
              purchase_roas: [{ action_type: "omni_purchase", value: "1" }],
            },
          ],
        }),
    });

    const { getInsightsPorAnuncio } = await import("../meta-ads");
    const result = await getInsightsPorAnuncio({ since: "2026-11-01", until: "2026-11-05" });

    expect(result.size).toBe(1);
    const insight = result.get("Criativo Genérico")!;
    expect(insight.gasto).toBe(100);
    expect(insight.compras).toBe(3);
    // receita = 4*40 + 1*60 = 220 -> roas = 220/100 = 2.2
    expect(insight.roas).toBeCloseTo(2.2, 5);
  });

  it("não perde dados reais quando NÃO há colisão — dois conjuntos com nomes diferentes continuam separados", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({
      json: () =>
        Promise.resolve({
          data: [
            {
              adset_id: "id1",
              adset_name: "Conjunto A",
              spend: "10",
              impressions: "100",
              reach: "90",
              clicks: "5",
              actions: [],
              purchase_roas: [],
            },
            {
              adset_id: "id2",
              adset_name: "Conjunto B",
              spend: "20",
              impressions: "200",
              reach: "180",
              clicks: "7",
              actions: [],
              purchase_roas: [],
            },
          ],
        }),
    });

    const { getInsightsPorConjunto } = await import("../meta-ads");
    const result = await getInsightsPorConjunto({ since: "2026-11-01", until: "2026-11-05" });

    expect(result.size).toBe(2);
    expect(result.get("Conjunto A")!.gasto).toBe(10);
    expect(result.get("Conjunto B")!.gasto).toBe(20);
  });

  it("paginação: duas páginas da API (paging.next) são concatenadas, nenhum registro se perde", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    let chamada = 0;
    fetchMock.mockImplementation(() => {
      chamada++;
      if (chamada === 1) {
        return Promise.resolve({
          json: () =>
            Promise.resolve({
              data: [
                {
                  adset_id: "id1",
                  adset_name: "Página 1",
                  spend: "10",
                  impressions: "100",
                  reach: "90",
                  clicks: "5",
                  actions: [],
                  purchase_roas: [],
                },
              ],
              paging: { next: "https://graph.facebook.com/v21.0/act_123/insights?after=cursor2" },
            }),
        });
      }
      return Promise.resolve({
        json: () =>
          Promise.resolve({
            data: [
              {
                adset_id: "id2",
                adset_name: "Página 2",
                spend: "20",
                impressions: "200",
                reach: "180",
                clicks: "7",
                actions: [],
                purchase_roas: [],
              },
            ],
            // sem paging.next -> fim da paginação
          }),
      });
    });

    const { getInsightsPorConjunto } = await import("../meta-ads");
    const result = await getInsightsPorConjunto({ since: "2026-11-01", until: "2026-11-05" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.size).toBe(2);
    expect(result.get("Página 1")!.gasto).toBe(10);
    expect(result.get("Página 2")!.gasto).toBe(20);
  });

  it("erro real da API (json.error) propaga como exceção — NUNCA vira silenciosamente um Map vazio/zerado", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({
      json: () => Promise.resolve({ error: { message: "Error validating access token." } }),
    });

    const { getInsightsPorConjunto } = await import("../meta-ads");
    await expect(getInsightsPorConjunto({ since: "2026-11-01", until: "2026-11-05" })).rejects.toThrow(
      /Meta Ads API: Error validating access token\./
    );
  });
});

// ============================================================================
// Preparado pelo agente de QA da missão Black Friday (2026-11-05) — cenários pedidos
// explicitamente pela missão, contra o comportamento ATUAL do conector (que outro agente, em
// paralelo, ainda vai mudar). Os testes abaixo codificam o contrato CORRETO esperado — quando
// marcados "falha hoje: ver bug", é esperado que falhem contra o código de hoje; documentam o
// bug até ser corrigido, não erro de quem escreveu o teste.
// ============================================================================
describe("getFotosPorNomeAnuncio — duas campanhas com anúncios de MESMO nome e IDs diferentes", () => {
  beforeEach(() => {
    findUnique.mockReset();
    upsert.mockReset();
    vi.stubGlobal("fetch", vi.fn());
    process.env.META_AD_ACCOUNT_ID = "123";
    process.env.META_ACCESS_TOKEN = "token-fake";
  });

  // falha hoje: ver bug — getFotosPorNomeAnuncio indexa tudo por NOME (idPorNome = Map<nome,id>,
  // só guarda o 1º id visto por nome — ver "for (const a of ads) if (!idPorNome.has(a.name))...“
  // em meta-ads.ts). Dois anúncios DE VERDADE diferentes ("id-1" numa campanha, "id-2" em outra)
  // que por coincidência têm o mesmo nome ("Black Friday" é um nome de criativo bem provável de
  // repetir entre campanhas) colidem: a foto do 2º nunca é buscada nem aparece — sobrescrita em
  // silêncio pela do 1º, exatamente o cenário que a missão pede pra nunca acontecer. Como o
  // próprio tipo de retorno já é Map<string, string[]> (suporta mais de 1 foto por nome, igual
  // fetchFotosAtivas já faz por conjunto), o contrato correto é mesclar as fotos dos dois
  // anúncios sob o mesmo nome, não descartar uma delas.
  it("falha hoje: ver bug — fotos de dois anúncios distintos com nome igual não deveriam se sobrescrever (hoje a 2ª é descartada em silêncio)", async () => {
    findUnique.mockImplementation(({ where }: { where: { clientLabel: string } }) => {
      if (where.clientLabel === "meta-ads-fotos-criativo") return Promise.resolve(null);
      return Promise.resolve({
        data: [
          { id: "id-1", name: "Black Friday", status: "ACTIVE" },
          { id: "id-2", name: "Black Friday", status: "ACTIVE" },
        ],
        updatedAt: new Date(),
      });
    });

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockImplementation((url: string) => {
      const foto = url.includes("id-1") ? "https://fbcdn.net/campanha1.jpg" : "https://fbcdn.net/campanha2.jpg";
      return Promise.resolve({ json: () => Promise.resolve({ creative: { thumbnail_url: foto } }) });
    });

    const { getFotosPorNomeAnuncio } = await import("../meta-ads");
    const result = await getFotosPorNomeAnuncio(mockPrisma(), ["Black Friday"]);

    expect(result.get("Black Friday")).toEqual(
      expect.arrayContaining(["https://fbcdn.net/campanha1.jpg", "https://fbcdn.net/campanha2.jpg"])
    );
  });
});

describe("getStatusPorNomeConjunto / getFotosPorNomeConjunto — dois conjuntos com nome igual, IDs diferentes", () => {
  beforeEach(() => {
    findUnique.mockReset();
    upsert.mockReset();
    vi.stubGlobal("fetch", vi.fn());
    process.env.META_AD_ACCOUNT_ID = "123";
    process.env.META_ACCESS_TOKEN = "token-fake";
  });

  // falha hoje: ver bug — mesmo problema estrutural do teste acima, mas pior: as DUAS funções que
  // leem o mesmo tipo de colisão (nome de conjunto repetido) resolvem a disputa de jeitos
  // diferentes e nenhum preserva o dado de verdade.
  //   - getStatusPorNomeConjunto usa `new Map(adsets.map(a => [a.name, a.status === "ACTIVE"]))`
  //     — Map padrão, ÚLTIMA entrada do array vence. Com adset-2 (PAUSED) depois de adset-1
  //     (ACTIVE) no array, o nome fica marcado como pausado mesmo tendo um conjunto ativo de
  //     verdade com esse nome.
  //   - getFotosPorNomeConjunto usa `adsets.find(a => a.name === nome)` — PRIMEIRA entrada vence,
  //     o oposto do critério acima. Nunca busca foto do 2º conjunto.
  // Contrato esperado (consistente com o critério que fetchFotosAtivas já usa dentro de 1 único
  // conjunto: prioriza ACTIVE sobre PAUSED): se QUALQUER conjunto com aquele nome está ativo, o
  // nome deve contar como ativo — e as fotos dos conjuntos ativos com aquele nome deveriam
  // aparecer todas, não só a do que por acaso é o 1º do array.
  it("falha hoje: ver bug — status deveria priorizar ACTIVE quando dois conjuntos colidem no nome (hoje depende só da ordem do array, não de qual está de fato ativo)", async () => {
    findUnique.mockImplementation(({ where }: { where: { clientLabel: string } }) => {
      if (where.clientLabel === "meta-ads-adsets-raw") {
        return Promise.resolve({
          data: [
            { id: "adset-1", name: "BOHO Conjunto", status: "ACTIVE" },
            { id: "adset-2", name: "BOHO Conjunto", status: "PAUSED" },
          ],
          updatedAt: new Date(),
        });
      }
      return Promise.resolve(null);
    });

    const { getStatusPorNomeConjunto } = await import("../meta-ads");
    const status = await getStatusPorNomeConjunto(mockPrisma(), ["BOHO Conjunto"]);

    expect(status.get("BOHO Conjunto")).toBe(true);
  });

  it("falha hoje: ver bug — fotos dos dois conjuntos com nome igual deveriam aparecer juntas (hoje só o 1º do array é buscado, o 2º nunca é tocado)", async () => {
    findUnique.mockImplementation(({ where }: { where: { clientLabel: string } }) => {
      if (where.clientLabel === "meta-ads-adsets-raw") {
        return Promise.resolve({
          data: [
            { id: "adset-1", name: "BOHO Conjunto", status: "ACTIVE" },
            { id: "adset-2", name: "BOHO Conjunto", status: "PAUSED" },
          ],
          updatedAt: new Date(),
        });
      }
      return Promise.resolve(null); // cache de fotos vazio
    });

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockImplementation((url: string) => {
      const foto = url.includes("adset-1") ? "https://fbcdn.net/adset1.jpg" : "https://fbcdn.net/adset2.jpg";
      return Promise.resolve({
        json: () => Promise.resolve({ data: [{ id: "x", status: "ACTIVE", creative: { thumbnail_url: foto } }] }),
      });
    });

    const { getFotosPorNomeConjunto } = await import("../meta-ads");
    const fotos = await getFotosPorNomeConjunto(mockPrisma(), ["BOHO Conjunto"]);

    expect(fotos.get("BOHO Conjunto")).toEqual(
      expect.arrayContaining(["https://fbcdn.net/adset1.jpg", "https://fbcdn.net/adset2.jpg"])
    );
  });
});

describe("fetchAllPages (via getInsightsPorConjunto) — paginação e erro de API", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    process.env.META_AD_ACCOUNT_ID = "123";
    process.env.META_ACCESS_TOKEN = "token-fake";
  });

  it("segue paging.next até não ter mais página, juntando os dados de TODAS as páginas (não só a 1ª)", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce({
        json: () =>
          Promise.resolve({
            data: [{ adset_id: "1", adset_name: "Conjunto 1", spend: "100" }],
            paging: { next: "https://graph.facebook.com/v21.0/act_123/insights?after=XYZ" },
          }),
      })
      .mockResolvedValueOnce({
        json: () => Promise.resolve({ data: [{ adset_id: "2", adset_name: "Conjunto 2", spend: "200" }] }),
      });

    const { getInsightsPorConjunto } = await import("../meta-ads");
    const result = await getInsightsPorConjunto({ since: "2026-11-01", until: "2026-11-04" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.get("Conjunto 1")?.gasto).toBe(100);
    expect(result.get("Conjunto 2")?.gasto).toBe(200);
  });

  it("erro retornado pela Graph API (token expirado, rate limit etc) propaga como exceção — NUNCA resolve silenciosamente pra Map vazio (zero gasto/investimento não pode significar 'a API falhou')", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({
      json: () => Promise.resolve({ error: { message: "Error validating access token" } }),
    });

    const { getInsightsPorConjunto } = await import("../meta-ads");
    await expect(getInsightsPorConjunto({ since: "2026-11-01", until: "2026-11-04" })).rejects.toThrow(
      /Error validating access token/
    );
  });
});

describe("getFotosPorNomeAnuncio — erro de API buscando creative não pode virar 'sem foto' em silêncio", () => {
  beforeEach(() => {
    findUnique.mockReset();
    upsert.mockReset();
    vi.stubGlobal("fetch", vi.fn());
    process.env.META_AD_ACCOUNT_ID = "123";
    process.env.META_ACCESS_TOKEN = "token-fake";
  });

  // falha hoje: ver bug — fetchCreativesPorIds (meta-ads.ts) lê `json.error` em NENHUM lugar:
  // `const json = await res.json(); const foto = extrairFoto(json.creative); if (foto) ...`. Se a
  // Graph API devolver {error: {...}} pra um ID específico (rate limit pontual, permissão,
  // criativo arquivado etc), json.creative vem undefined, extrairFoto devolve undefined, e o
  // resultado final é idêntico ao de um anúncio que genuinamente não tem foto — [] sem nenhum
  // sinal de que algo falhou. Mesma classe de bug que o comentário em page.tsx já reconhece pro
  // catch silencioso de investimento (getInsightsPorConjunto/Anuncio) — aqui é mais sutil porque
  // nem precisa de um catch: a própria função nunca verifica o campo de erro.
  it("falha hoje: ver bug — erro da Graph API ao buscar creative de um anúncio fica indistinguível de 'esse anúncio não tem foto'", async () => {
    findUnique.mockImplementation(({ where }: { where: { clientLabel: string } }) => {
      if (where.clientLabel === "meta-ads-fotos-criativo") return Promise.resolve(null);
      return Promise.resolve({
        data: [{ id: "id-err", name: "Anuncio Com Erro", status: "ACTIVE" }],
        updatedAt: new Date(),
      });
    });

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({
      json: () => Promise.resolve({ error: { message: "Please reduce the amount of data you're asking for" } }),
    });

    const { getFotosPorNomeAnuncio } = await import("../meta-ads");

    // Contrato esperado: um erro real da API nunca deveria se disfarçar de "sem foto" (dado
    // legítimo vazio) — deveria pelo menos propagar, pra quem chama poder diferenciar os dois
    // casos (hoje resolve [] normalmente, sem exceção nenhuma).
    await expect(getFotosPorNomeAnuncio(mockPrisma(), ["Anuncio Com Erro"])).rejects.toThrow();
  });
});
