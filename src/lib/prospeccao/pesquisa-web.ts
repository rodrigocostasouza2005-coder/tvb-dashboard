export type ResultadoBusca = { url: string; titulo: string; trecho: string };
export type EvidenciaSite = {
  url: string; titulo: string; descricao: string; texto: string; marcas: string[];
  sinaisModaMasculina: string[]; sinaisMultimarcas: string[];
  sinaisExclusao?: string[]; sinaisMarcaPropria?: string[]; sinaisModaFeminina?: string[]; sinaisSurfSkate?: string[];
  /**
   * Marcas candidatas FORA das 24 referências de `MARCAS` abaixo (curadoria dinâmica, Fase 3 da
   * faxina pós-auditoria 2026-11 — ver docs/expansao-atacadista/PROSPECCAO_AUTOMATICA.md e
   * adaptadores-qualificacao.ts). Nunca é reconhecimento ingênuo de substantivo próprio: só existe
   * candidato quando um nome em Title Case aparece na JANELA DE TEXTO imediatamente após um sinal
   * explícito de multimarcas (`MULTIMARCAS` abaixo) — a mesma régua de evidência que já valia pras
   * 24 marcas fixas. Confiança sempre limitada a MEDIA nesta camada (nunca ALTA): é detecção por
   * padrão de texto, não confirmação humana nem fonte estruturada — quem decide o destino final
   * (contar ou cair em revisão humana) é o motor (motor-elegibilidade.ts/motor-qualificacao.ts),
   * nunca este extrator.
   */
  marcasCandidatas?: string[];
};
const MARCAS = ["Reserva","Aramis","Osklen","Ellus","Tommy Hilfiger","Lacoste","Calvin Klein","Colcci","John John","Dudalina","Foxton","Richards","VR","Levi's","Levis","Nike","Adidas","Polo Wear","Cavalera","Diesel","Hugo Boss","Zara","Riachuelo","Hering","Sergio K"];
const MASCULINO = ["moda masculina","roupa masculina","roupas masculinas","masculino","masculina","menswear","moda para homens","camisaria masculina"];
// Sinais explícitos de revenda de marcas de terceiros; termos ambíguos foram removidos.
const MULTIMARCAS = ["loja multimarcas","moda masculina multimarcas","trabalhamos com marcas","marcas que trabalhamos","marcas que vendemos","revendedor autorizado","revenda de marcas","marcas parceiras","marcas disponíveis"];
// Palavras em Title Case que aparecem com frequência perto de um sinal de multimarcas mas nunca
// são nome de marca — sem isto, a janela de texto após o sinal capturaria a primeira palavra da
// própria frase (ex.: "Trabalhamos com marcas: Nike..." capturaria "Trabalhamos"). Lista fechada e
// pequena de propósito: isto NÃO é um filtro de qualidade de marca (isso é papel do motor), é só
// um filtro de ruído gramatical óbvio no ponto de extração.
const PALAVRAS_IGNORADAS_CANDIDATO_MARCA = new Set([
  "trabalhamos","revendemos","vendemos","disponivel","disponiveis","parceiras","parceiros",
  "autorizado","autorizada","confira","conheca","veja","clique","acesse","visite","entre",
  "outras","outros","diversas","diversos","variadas","variados","nossas","nosso","nossa","loja",
  "lojas","marca","marcas","multimarcas","instagram","facebook","whatsapp","rio","sao","voce",
]);
const MARCA_PROPRIA = ["marca própria","produção própria","fabricação própria","confecção própria","coleção própria","coleções próprias","produto autoral","marca autoral","marca da casa","nossa marca","nossas coleções","somos fabricantes","direto da fábrica"];
const EXCLUSOES = ["somente moda feminina","apenas moda feminina","exclusivamente feminina","não trabalhamos com moda masculina","não vendemos roupas masculinas","loja de lingerie","lingerie","moda íntima","sutiã","calcinha","semijoias","bijuterias","loja de bijuterias","joalheria","loja de móveis","móveis planejados","estofados","colchões","loja de decoração","restaurante","pizzaria","lanchonete","hamburgueria","churrascaria","sushi","padaria","cafeteria","supermercado","mercearia","açougue","alimentos","delivery de comida"];
const MODA_FEMININA = ["moda feminina","roupas femininas","vestuário feminino","moda para mulheres"];
const SURF_SKATE = ["surf shop","surfwear","surf wear","surf","skate shop","skateshop","skatewear","streetwear","boardshop","pranchas de surf","moda praia masculina","roupas de surf"];
const SOCIAIS = new Set(["instagram.com","facebook.com","tiktok.com","linkedin.com","youtube.com"]);
export function decodeHtml(v:string):string { return v.replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&#(\d+);/g,(_,n:string)=>String.fromCodePoint(Number(n))).replace(/&#x([\da-f]+);/gi,(_,n:string)=>String.fromCodePoint(parseInt(n,16))); }
export function normalizarTexto(v:string):string { return decodeHtml(v).replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim(); }
export function normalizarUrl(v:string):string|null { try { const u=new URL(v.startsWith("//")?`https:${v}`:v); if(!["https:","http:"].includes(u.protocol))return null;u.hash="";return u.toString(); } catch{return null;} }
export function extrairResultadosBusca(html:string):ResultadoBusca[] { const out:ResultadoBusca[]=[]; for(const block of html.split(/<div[^>]+class="[^"]*result[^"]*"/i).slice(1)){ const m=block.match(/<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i); if(!m)continue; let dest=decodeHtml(m[1]); try{const u=new URL(dest,"https://html.duckduckgo.com");dest=u.searchParams.get("uddg")?decodeURIComponent(u.searchParams.get("uddg")!):dest;}catch{continue;} const url=normalizarUrl(dest);if(!url)continue;const snippet=block.match(/class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/[^>]+>/i)?.[1]??"";out.push({url,titulo:normalizarTexto(m[2]),trecho:normalizarTexto(snippet)});}return out; }
export function hostEhRedeSocial(url:string):boolean { try{const h=new URL(url).hostname.toLowerCase().replace(/^www\./,"");return SOCIAIS.has(h)||h.endsWith(".instagram.com")||h.endsWith(".facebook.com");}catch{return false;} }
function semAcento(v: string): string {
  return v.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/**
 * Candidato "parece marca"? Filtro de ru\u00eddo gramatical s\u00f3 (ver coment\u00e1rio na constante acima) \u2014
 * NUNCA uma avalia\u00e7\u00e3o de legitimidade comercial. Rejeita token curto demais (<3 letras) e as
 * palavras da lista de ignorados (case/acento-insens\u00edvel).
 */
function pareceNomeDeMarca(token: string): boolean {
  const limpo = token.trim();
  if (limpo.length < 3) return false;
  const chave = semAcento(limpo).toLowerCase();
  return !PALAVRAS_IGNORADAS_CANDIDATO_MARCA.has(chave);
}

/**
 * Curadoria din\u00e2mica de marcas (Fase 3, faxina p\u00f3s-auditoria 2026-11): acha nomes candidatos a
 * marca de terceiro FORA da lista fixa `MARCAS`, mas s\u00f3 dentro de uma janela curta de texto
 * IMEDIATAMENTE DEPOIS de um sinal expl\u00edcito de multimarcas j\u00e1 encontrado em `combinadoOriginal`
 * (preserva mai\u00fasculas \u2014 "all" no resto do arquivo j\u00e1 normaliza tudo pra min\u00fasculo/sem acento, o
 * que destruiria o sinal de Title Case que distingue um nome pr\u00f3prio de uma palavra comum).
 *
 * Deliberadamente N\u00c3O \u00e9 "qualquer palavra capitalizada do texto": sem proximidade com um sinal de
 * multimarcas, nenhum nome \u00e9 extra\u00eddo, mesmo que apare\u00e7a em outro lugar da p\u00e1gina (ex.: endere\u00e7o,
 * nome do bairro, outra se\u00e7\u00e3o do site) \u2014 a MESMA r\u00e9gua de evid\u00eancia que j\u00e1 valia pra popular
 * `marcas` com as 24 refer\u00eancias fixas.
 */
function extrairMarcasCandidatas(combinadoOriginal: string): string[] {
  const TAMANHO_JANELA = 160;
  const MAX_CANDIDATOS = 8;
  const candidatos: string[] = [];
  const vistos = new Set<string>();
  for (const sinal of MULTIMARCAS) {
    const regexSinal = new RegExp(sinal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    const match = regexSinal.exec(combinadoOriginal);
    if (!match) continue;
    const inicioJanela = match.index + match[0].length;
    const janela = combinadoOriginal.slice(inicioJanela, inicioJanela + TAMANHO_JANELA);
    const tokens = janela.match(/\b[A-Z\u00c0-\u00da\u00c7][a-z\u00e0-\u00fa\u00e7\u00e2\u00ea\u00ee\u00f4\u00fb\u00e3\u00f5'\u2019]+(?:\s+[A-Z\u00c0-\u00da\u00c7][a-z\u00e0-\u00fa\u00e7\u00e2\u00ea\u00ee\u00f4\u00fb\u00e3\u00f5'\u2019]+){0,2}\b/g) ?? [];
    for (const token of tokens) {
      if (candidatos.length >= MAX_CANDIDATOS) break;
      const chave = semAcento(token).toLowerCase();
      if (vistos.has(chave)) continue;
      if (MARCAS.some((m) => semAcento(m).toLowerCase() === chave)) continue; // j\u00e1 contado em `marcas`
      if (!pareceNomeDeMarca(token)) continue;
      vistos.add(chave);
      candidatos.push(token.trim());
    }
  }
  return candidatos;
}

export function extrairEvidenciasSite(url:string,html:string):EvidenciaSite {
  const title=html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]??"";
  const desc=html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)?.[1]??html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i)?.[1]??"";
  const text=normalizarTexto(html.replace(/<(script|style|noscript|svg)[^>]*>[\s\S]*?<\/\1>/gi," ").replace(/<[^>]+>/g," ")).slice(0,30000);
  const combinadoOriginal=`${normalizarTexto(title)} ${normalizarTexto(desc)} ${text}`;
  const all=combinadoOriginal.toLocaleLowerCase("pt-BR").normalize("NFD").replace(/[\u0300-\u036f]/g,"");
  const match=(terms:string[])=>terms.filter(x=>all.includes(x.normalize("NFD").replace(/[\u0300-\u036f]/g,"")));
  return {
    url,titulo:normalizarTexto(title),descricao:normalizarTexto(desc),texto:text,
    marcas:MARCAS.filter(x=>all.includes(x.toLocaleLowerCase("pt-BR"))),
    sinaisModaMasculina:match(MASCULINO),
    sinaisMultimarcas:match(MULTIMARCAS),
    sinaisExclusao:match(EXCLUSOES),
    sinaisMarcaPropria:match(MARCA_PROPRIA),
    sinaisModaFeminina:match(MODA_FEMININA),
    sinaisSurfSkate:match(SURF_SKATE),
    marcasCandidatas:extrairMarcasCandidatas(combinadoOriginal),
  };
}
export function calcularConfiancaPesquisa(input:{nomeLoja:string;cidade:string|null;titulo:string;descricao:string;texto:string}):"ALTA"|"MEDIA"|"BAIXA"{const norm=(s:string)=>s.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();const parts=norm(input.nomeLoja).split(/\s+/).filter(x=>x.length>2);const evidence=norm(`${input.titulo} ${input.descricao} ${input.texto}`);const ratio=parts.length?parts.filter(x=>evidence.includes(x)).length/parts.length:0;const city=!!input.cidade&&evidence.includes(norm(input.cidade));if(ratio>=.7&&city)return"ALTA";if(ratio>=.5||(ratio>=.35&&city))return"MEDIA";return"BAIXA";}
