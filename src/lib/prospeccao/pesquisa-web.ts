export type ResultadoBusca = { url: string; titulo: string; trecho: string };
export type EvidenciaSite = {
  url: string; titulo: string; descricao: string; texto: string; marcas: string[];
  sinaisModaMasculina: string[]; sinaisMultimarcas: string[];
  sinaisExclusao?: string[]; sinaisMarcaPropria?: string[]; sinaisModaFeminina?: string[]; sinaisSurfSkate?: string[];
};
const MARCAS = ["Reserva","Aramis","Osklen","Ellus","Tommy Hilfiger","Lacoste","Calvin Klein","Colcci","John John","Dudalina","Foxton","Richards","VR","Levi's","Levis","Nike","Adidas","Polo Wear","Cavalera","Diesel","Hugo Boss","Zara","Riachuelo","Hering","Sergio K"];
const MASCULINO = ["moda masculina","roupa masculina","roupas masculinas","masculino","masculina","menswear","moda para homens","camisaria masculina"];
// Sinais explícitos de revenda de marcas de terceiros; termos ambíguos foram removidos.
const MULTIMARCAS = ["loja multimarcas","moda masculina multimarcas","trabalhamos com marcas","marcas que trabalhamos","marcas que vendemos","revendedor autorizado","revenda de marcas","marcas parceiras","marcas disponíveis"];
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
export function extrairEvidenciasSite(url:string,html:string):EvidenciaSite {
  const title=html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]??"";
  const desc=html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)?.[1]??html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i)?.[1]??"";
  const text=normalizarTexto(html.replace(/<(script|style|noscript|svg)[^>]*>[\s\S]*?<\/\1>/gi," ").replace(/<[^>]+>/g," ")).slice(0,30000);
  const all=(`${title} ${desc} ${text}`).toLocaleLowerCase("pt-BR").normalize("NFD").replace(/[\u0300-\u036f]/g,"");
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
  };
}
export function calcularConfiancaPesquisa(input:{nomeLoja:string;cidade:string|null;titulo:string;descricao:string;texto:string}):"ALTA"|"MEDIA"|"BAIXA"{const norm=(s:string)=>s.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();const parts=norm(input.nomeLoja).split(/\s+/).filter(x=>x.length>2);const evidence=norm(`${input.titulo} ${input.descricao} ${input.texto}`);const ratio=parts.length?parts.filter(x=>evidence.includes(x)).length/parts.length:0;const city=!!input.cidade&&evidence.includes(norm(input.cidade));if(ratio>=.7&&city)return"ALTA";if(ratio>=.5||(ratio>=.35&&city))return"MEDIA";return"BAIXA";}
