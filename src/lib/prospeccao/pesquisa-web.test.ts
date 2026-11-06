import {describe,expect,it} from "vitest";
import {calcularConfiancaPesquisa,extrairEvidenciasSite,extrairResultadosBusca,hostEhRedeSocial} from "./pesquisa-web";
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
