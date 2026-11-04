import {describe,expect,it} from "vitest";
import {calcularConfiancaPesquisa,extrairEvidenciasSite,extrairResultadosBusca,hostEhRedeSocial} from "./pesquisa-web";
describe("pesquisa comercial web",()=>{
it("extrai URLs redirecionadas dos resultados",()=>{const html='<div class="result"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Finstagram.com%2Floja.teste">Loja Teste Instagram</a><a class="result__snippet">Perfil oficial</a></div>';const r=extrairResultadosBusca(html);expect(r).toHaveLength(1);expect(r[0].url).toBe("https://instagram.com/loja.teste");});
it("identifica redes sociais",()=>{expect(hostEhRedeSocial("https://www.instagram.com/loja/")).toBe(true);expect(hostEhRedeSocial("https://loja.com")).toBe(false);});
it("extrai sinais comerciais e marcas do site",()=>{const r=extrairEvidenciasSite("https://loja.com",'<title>Loja Teste</title><meta name="description" content="Moda masculina multimarcas"><main>Trabalhamos com Reserva, Aramis e Lacoste.</main>');expect(r.sinaisModaMasculina).toContain("moda masculina");expect(r.sinaisMultimarcas).toContain("multimarcas");expect(r.marcas).toEqual(expect.arrayContaining(["Reserva","Aramis","Lacoste"]));});
it("exige nome e cidade para confiança alta",()=>{expect(calcularConfiancaPesquisa({nomeLoja:"Loja Costa Moda",cidade:"Niterói",titulo:"Loja Costa Moda Niterói",descricao:"",texto:""})).toBe("ALTA");expect(calcularConfiancaPesquisa({nomeLoja:"Loja Costa Moda",cidade:"Niterói",titulo:"Moda masculina",descricao:"",texto:""})).toBe("BAIXA");});
});
