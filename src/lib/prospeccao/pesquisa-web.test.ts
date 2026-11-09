import {describe,expect,it,vi} from "vitest";
import {calcularConfiancaPesquisa,derivarDominioEmail,derivarUrlsCandidatasPorEmail,extrairEvidenciasSite,extrairResultadosBusca,hostEhProvedorEmailGenerico,hostEhRedeSocial,tentarSiteViaDominioEmail} from "./pesquisa-web";
describe("pesquisa comercial web",()=>{
it("extrai URLs redirecionadas dos resultados",()=>{const html='<div class="result"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Finstagram.com%2Floja.teste">Loja Teste Instagram</a><a class="result__snippet">Perfil oficial</a></div>';const r=extrairResultadosBusca(html);expect(r).toHaveLength(1);expect(r[0].url).toBe("https://instagram.com/loja.teste");});
it("identifica redes sociais",()=>{expect(hostEhRedeSocial("https://www.instagram.com/loja/")).toBe(true);expect(hostEhRedeSocial("https://loja.com")).toBe(false);});
it("extrai sinais comerciais e marcas do site",()=>{const r=extrairEvidenciasSite("https://loja.com",'<title>Loja Teste</title><meta name="description" content="Moda masculina multimarcas"><main>Trabalhamos com Reserva, Aramis e Lacoste.</main>');expect(r.sinaisModaMasculina).toContain("moda masculina");expect(r.sinaisMultimarcas).toContain("moda masculina multimarcas");expect(r.marcas).toEqual(expect.arrayContaining(["Reserva","Aramis","Lacoste"]));});
it("detecta categorias incompatíveis, marca própria e moda feminina",()=>{
 const lingerie=extrairEvidenciasSite("https://loja.com",'<title>Moda feminina e lingerie</title><main>Loja de lingerie, moda íntima e peças femininas.</main>');
 expect(lingerie.sinaisExclusao).toContain("lingerie");
 expect(lingerie.sinaisModaFeminina).toContain("moda feminina");
 const biju=extrairEvidenciasSite("https://loja.com",'<title>Bijuterias e semijoias</title><main>Loja de bijuterias e semijoias.</main>');
 expect(biju.sinaisExclusao).toContain("bijuterias");
 const moveis=extrairEvidenciasSite("https://loja.com",'<title>Móveis planejados</title><main>Loja de móveis planejados e estofados.</main>');
 expect(moveis.sinaisExclusao).toContain("móveis planejados");
 const comida=extrairEvidenciasSite("https://loja.com",'<title>Restaurante</title><main>Restaurante e pizzaria.</main>');
 expect(comida.sinaisExclusao).toContain("restaurante");
 const propria=extrairEvidenciasSite("https://loja.com",'<title>Marca própria</title><main>Produção própria e fabricação própria.</main>');
 expect(propria.sinaisMarcaPropria).toContain("marca própria");
});
it("detecta operação exclusivamente feminina mesmo com menção negativa ao masculino",()=>{
 const r=extrairEvidenciasSite("https://loja.com",'<title>Moda feminina</title><main>Somente moda feminina. Não trabalhamos com moda masculina.</main>');
 expect(r.sinaisExclusao).toContain("somente moda feminina");
 expect(r.sinaisExclusao).toContain("não trabalhamos com moda masculina");
});
it("exige nome e cidade para confiança alta",()=>{expect(calcularConfiancaPesquisa({nomeLoja:"Loja Costa Moda",cidade:"Niterói",titulo:"Loja Costa Moda Niterói",descricao:"",texto:""})).toBe("ALTA");expect(calcularConfiancaPesquisa({nomeLoja:"Loja Costa Moda",cidade:"Niterói",titulo:"Moda masculina",descricao:"",texto:""})).toBe("BAIXA");});

describe("marcasCandidatas — curadoria dinâmica de marcas fora das 24 referências (Fase 3)",()=>{
  it("reconhece marca legítima fora da lista fixa quando aparece logo depois de um sinal explícito de multimarcas",()=>{
    const r=extrairEvidenciasSite("https://loja.com",'<title>Loja Surf</title><main>Somos loja multimarcas. Marcas disponíveis: Billabong, Quiksilver e Rip Curl.</main>');
    expect(r.marcasCandidatas).toEqual(expect.arrayContaining(["Billabong","Quiksilver","Rip Curl"]));
  });

  it("não extrai nada quando não há nenhum sinal de multimarcas na página, mesmo com nomes em Title Case em outro lugar",()=>{
    const r=extrairEvidenciasSite("https://loja.com",'<title>Loja Billabong Store</title><main>Rua das Flores, 123, Niterói. Atendimento de segunda a sábado.</main>');
    expect(r.marcasCandidatas).toEqual([]);
  });

  it("não duplica como candidata uma marca que já está na lista fixa (Nike já conta via `marcas`)",()=>{
    const r=extrairEvidenciasSite("https://loja.com",'<title>Loja</title><main>Loja multimarcas. Marcas disponíveis: Nike e Adidas.</main>');
    expect(r.marcas).toEqual(expect.arrayContaining(["Nike","Adidas"]));
    expect(r.marcasCandidatas).toEqual([]);
  });

  it("ignora palavras gramaticais comuns que aparecem na própria frase do sinal (ex.: 'Trabalhamos')",()=>{
    const r=extrairEvidenciasSite("https://loja.com",'<title>Loja</title><main>Trabalhamos com marcas: Volcom e Element.</main>');
    expect(r.marcasCandidatas).not.toContain("Trabalhamos");
    expect(r.marcasCandidatas).toEqual(expect.arrayContaining(["Volcom","Element"]));
  });
});
});

/**
 * Melhoria 2 (piloto RJ, nov/2026): fallback de descoberta de site via domínio de e-mail, porque a
 * busca via DuckDuckGo está sendo bloqueada por anti-bot em qualquer infraestrutura de nuvem
 * testada. Testes cobrem só a decisão de QUAL URL tentar e a orquestração do fallback (com rede
 * mockada) — nunca mudam a régua de evidência de marca em si (extrairEvidenciasSite/
 * calcularConfiancaPesquisa, inalterados e já cobertos acima).
 */
describe("derivarDominioEmail", () => {
  it("extrai o domínio de um e-mail válido", () => {
    expect(derivarDominioEmail("contato@lojateste.com.br")).toBe("lojateste.com.br");
    expect(derivarDominioEmail("Contato@LojaTeste.COM")).toBe("lojateste.com");
  });
  it("retorna null para valores sem formato mínimo de e-mail", () => {
    expect(derivarDominioEmail(null)).toBeNull();
    expect(derivarDominioEmail(undefined)).toBeNull();
    expect(derivarDominioEmail("")).toBeNull();
    expect(derivarDominioEmail("sem-arroba")).toBeNull();
    expect(derivarDominioEmail("@semusuario.com")).toBeNull();
    expect(derivarDominioEmail("usuario@")).toBeNull();
    expect(derivarDominioEmail("usuario@dominio-sem-ponto")).toBeNull();
  });
});

describe("hostEhProvedorEmailGenerico", () => {
  it("reconhece os provedores genéricos explicitamente listados pelo Rodrigo", () => {
    for (const dominio of ["gmail.com","hotmail.com","outlook.com","yahoo.com.br","yahoo.com","bol.com.br","uol.com.br","terra.com.br","icloud.com","live.com","msn.com","globo.com","ig.com.br","r7.com"]) {
      expect(hostEhProvedorEmailGenerico(dominio)).toBe(true);
    }
  });
  it("nunca marca o domínio próprio de uma loja como genérico", () => {
    expect(hostEhProvedorEmailGenerico("lojateste.com.br")).toBe(false);
    expect(hostEhProvedorEmailGenerico("surfshoprio.com")).toBe(false);
  });
});

describe("derivarUrlsCandidatasPorEmail", () => {
  it("domínio não-genérico: deriva https://dominio e https://www.dominio", () => {
    expect(derivarUrlsCandidatasPorEmail("contato@lojateste.com.br")).toEqual([
      "https://lojateste.com.br",
      "https://www.lojateste.com.br",
    ]);
  });
  it("domínio genérico (gmail etc.): não deriva nenhuma URL", () => {
    expect(derivarUrlsCandidatasPorEmail("dono@gmail.com")).toEqual([]);
    expect(derivarUrlsCandidatasPorEmail("contato@hotmail.com")).toEqual([]);
  });
  it("e-mail ausente/inválido: não deriva nenhuma URL", () => {
    expect(derivarUrlsCandidatasPorEmail(null)).toEqual([]);
    expect(derivarUrlsCandidatasPorEmail("")).toEqual([]);
  });
});

describe("tentarSiteViaDominioEmail — orquestração com rede mockada", () => {
  it("domínio não-genérico com site respondendo: devolve a primeira URL que respondeu", async () => {
    const podeVisitar = vi.fn(async () => true);
    const buscarHtml = vi.fn(async (url: string) => (url === "https://lojateste.com.br" ? "<title>Loja Teste</title>" : null));
    const resultado = await tentarSiteViaDominioEmail({ email: "contato@lojateste.com.br", podeVisitar, buscarHtml });
    expect(resultado).toEqual({ url: "https://lojateste.com.br", html: "<title>Loja Teste</title>" });
    expect(buscarHtml).toHaveBeenCalledWith("https://lojateste.com.br");
  });

  it("domínio genérico (gmail etc.): não tenta nenhum fetch, devolve null direto", async () => {
    const podeVisitar = vi.fn(async () => true);
    const buscarHtml = vi.fn(async () => "<title>nunca deveria chegar aqui</title>");
    const resultado = await tentarSiteViaDominioEmail({ email: "dono@gmail.com", podeVisitar, buscarHtml });
    expect(resultado).toBeNull();
    expect(podeVisitar).not.toHaveBeenCalled();
    expect(buscarHtml).not.toHaveBeenCalled();
  });

  it("domínio não-genérico mas fetch falha (timeout/DNS/404/robots): cai sem quebrar, devolve null", async () => {
    const podeVisitar = vi.fn(async () => true);
    const buscarHtml = vi.fn(async () => null); // simula timeout/DNS/404
    const resultado = await tentarSiteViaDominioEmail({ email: "contato@lojainexistente.com.br", podeVisitar, buscarHtml });
    expect(resultado).toBeNull();
  });

  it("robots.txt desautoriza a URL base: tenta a variante www antes de desistir", async () => {
    const podeVisitar = vi.fn(async (url: string) => url !== "https://lojateste.com.br"); // bare domain bloqueado
    const buscarHtml = vi.fn(async (url: string) => (url === "https://www.lojateste.com.br" ? "<title>Loja Teste</title>" : null));
    const resultado = await tentarSiteViaDominioEmail({ email: "contato@lojateste.com.br", podeVisitar, buscarHtml });
    expect(resultado).toEqual({ url: "https://www.lojateste.com.br", html: "<title>Loja Teste</title>" });
  });

  it("sem e-mail: não tenta nenhum fetch, devolve null direto", async () => {
    const podeVisitar = vi.fn(async () => true);
    const buscarHtml = vi.fn(async () => "<title>nunca deveria chegar aqui</title>");
    const resultado = await tentarSiteViaDominioEmail({ email: null, podeVisitar, buscarHtml });
    expect(resultado).toBeNull();
    expect(buscarHtml).not.toHaveBeenCalled();
  });
});

describe("Melhoria 2 — site via domínio encontrado mas sem sinal de multimarcas não conta evidência", () => {
  it("extrairEvidenciasSite sobre o HTML do domínio do e-mail não inventa sinaisMultimarcas quando não há nenhum", async () => {
    const podeVisitar = vi.fn(async () => true);
    const html = '<title>Loja Teste</title><main>Rua das Flores, 123, loja de roupas.</main>';
    const buscarHtml = vi.fn(async () => html);
    const tentativa = await tentarSiteViaDominioEmail({ email: "contato@lojateste.com.br", podeVisitar, buscarHtml });
    expect(tentativa).not.toBeNull();
    const evidencia = extrairEvidenciasSite(tentativa!.url, tentativa!.html);
    // Mesma régua de sempre: sem sinal explícito de multimarcas, nenhuma marca conta — mesmo que o
    // site tenha sido encontrado via domínio de e-mail em vez de busca.
    expect(evidencia.sinaisMultimarcas).toEqual([]);
    expect(evidencia.marcas).toEqual([]);
    expect(evidencia.marcasCandidatas).toEqual([]);
  });
});
