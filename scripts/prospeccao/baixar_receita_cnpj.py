#!/usr/bin/env python3
"""Download retomável dos ZIPs públicos do CNPJ/Receita via Nextcloud WebDAV.

Não extrai arquivos. Por padrão apenas lista o que seria baixado (--dry-run).
"""
from __future__ import annotations

import argparse
import os
import re
import shutil
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

SHARE_TOKEN = "YggdBLfdninEJX9"
BASE = "https://arquivos.receitafederal.gov.br/public.php/dav/files"
DEFAULT_REMOTE = "Dados/Cadastros/CNPJ"
FAMILY_PATTERNS = {
    "estabelecimentos": re.compile(r"^Estabelecimentos\\d+\\.zip$", re.I),
    "empresas": re.compile(r"^Empresas\\d+\\.zip$", re.I),
    "municipios": re.compile(r"^Municipios\\.zip$", re.I),
}
NS = {"d": "DAV:"}


def request(url: str, method: str = "GET", data: bytes | None = None, headers=None):
    req = urllib.request.Request(url, data=data, method=method, headers=headers or {})
    return urllib.request.urlopen(req, timeout=90)


def list_directory(url: str) -> list[dict]:
    body = b"""<?xml version="1.0"?>
    <d:propfind xmlns:d="DAV:"><d:prop>
    <d:resourcetype/><d:getcontentlength/><d:getlastmodified/>
    </d:prop></d:propfind>"""
    with request(url, "PROPFIND", body, {"Depth": "1", "Content-Type": "application/xml"}) as response:
        xml = ET.fromstring(response.read())
    items = []
    for node in xml.findall("d:response", NS):
        href = node.findtext("d:href", default="", namespaces=NS)
        prop = node.find(".//d:prop", NS)
        if prop is None:
            continue
        resource = prop.find("d:resourcetype", NS)
        is_dir = resource is not None and resource.find("d:collection", NS) is not None
        size = prop.findtext("d:getcontentlength", default="0", namespaces=NS)
        name = urllib.parse.unquote(href.rstrip("/").split("/")[-1])
        if name and name not in (".", ".."):
            items.append({"name": name, "directory": is_dir, "size": int(size or 0), "href": href})
    return items


def discover_competence(token: str, remote: str) -> tuple[str, str]:
    root = f"{BASE}/{urllib.parse.quote(token, safe='')}/{urllib.parse.quote(remote.strip('/'), safe='/')}/"
    dirs = [x["name"] for x in list_directory(root) if x["directory"] and re.fullmatch(r"20\\d{2}-\\d{2}", x["name"])]
    if not dirs:
        raise RuntimeError(f"Nenhuma competência AAAA-MM encontrada em {root}")
    latest = max(dirs)
    return latest, root + urllib.parse.quote(latest, safe="") + "/"


def download_file(url: str, destination: Path, expected_size: int, retries: int = 4):
    destination.parent.mkdir(parents=True, exist_ok=True)
    partial = destination.with_suffix(destination.suffix + ".part")
    for attempt in range(retries):
        offset = partial.stat().st_size if partial.exists() else 0
        headers = {"Range": f"bytes={offset}-"} if offset else {}
        try:
            with request(url, headers=headers) as response:
                status = getattr(response, "status", response.getcode())
                if offset and status != 206:
                    offset = 0
                    partial.unlink(missing_ok=True)
                mode = "ab" if offset else "wb"
                with partial.open(mode) as output:
                    shutil.copyfileobj(response, output, length=1024 * 1024)
            if expected_size and partial.stat().st_size != expected_size:
                raise IOError(f"Tamanho divergente: {partial.stat().st_size}/{expected_size}")
            with zipfile.ZipFile(partial) as archive:
                bad = archive.testzip()
                if bad:
                    raise zipfile.BadZipFile(f"CRC inválido: {bad}")
            partial.replace(destination)
            return
        except (OSError, urllib.error.URLError, zipfile.BadZipFile) as exc:
            if attempt + 1 == retries:
                raise
            print(f"Tentativa {attempt + 1}/{retries} falhou para {destination.name}: {exc}", file=sys.stderr)
            time.sleep(2 ** attempt)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--token", default=SHARE_TOKEN)
    parser.add_argument("--remote-path", default=DEFAULT_REMOTE)
    parser.add_argument("--competencia", default="latest", help="latest ou AAAA-MM")
    parser.add_argument("--familias", nargs="+", choices=FAMILY_PATTERNS, default=["estabelecimentos", "empresas", "municipios"])
    parser.add_argument("--destino", type=Path, default=Path("dados/receita-cnpj"))
    parser.add_argument("--limite-gb", type=float, default=12.0, help="limite de download; use 0 para desativar")
    parser.add_argument("--dry-run", action="store_true", help="somente lista arquivos e tamanhos (padrão)")
    parser.add_argument("--download", action="store_true", help="confirma o download")
    args = parser.parse_args()
    if args.dry_run and args.download:
        parser.error("use --dry-run ou --download, não ambos")
    if not args.dry_run and not args.download:
        args.dry_run = True

    latest, latest_url = discover_competence(args.token, args.remote_path)
    competence = latest if args.competencia == "latest" else args.competencia
    if not re.fullmatch(r"20\\d{2}-(0[1-9]|1[0-2])", competence):
        parser.error("--competencia deve ser latest ou AAAA-MM")
    folder_url = latest_url if competence == latest else latest_url.rsplit(latest + "/", 1)[0] + urllib.parse.quote(competence, safe="") + "/"
    entries = list_directory(folder_url)
    selected = [x for x in entries if not x["directory"] and any(FAMILY_PATTERNS[f].fullmatch(x["name"]) for f in args.familias)]
    if not selected:
        raise RuntimeError(f"Nenhum ZIP das famílias {args.familias} em {competence}; verifique o layout remoto.")
    total = sum(x["size"] for x in selected)
    print(f"Competência: {competence} | arquivos: {len(selected)} | total: {total / 1024**3:.2f} GiB")
    for item in selected:
        print(f"{item['size'] / 1024**2:8.1f} MiB  {item['name']}")
    if args.limite_gb > 0 and total > args.limite_gb * 1024**3:
        raise RuntimeError(f"Download excede o limite de {args.limite_gb:.1f} GiB. Ajuste --limite-gb conscientemente.")
    if args.dry_run:
        print("Prévia apenas; nada foi baixado. Para executar, acrescente --download.")
        return 0
    target = args.destino / competence
    target.mkdir(parents=True, exist_ok=True)
    for item in selected:
        url = urllib.parse.urljoin(folder_url, urllib.parse.quote(item["name"]))
        path = target / item["name"]
        if path.exists() and (not item["size"] or path.stat().st_size == item["size"]):
            try:
                with zipfile.ZipFile(path) as archive:
                    if archive.testzip() is None:
                        print(f"Já íntegro: {path.name}")
                        continue
            except zipfile.BadZipFile:
                pass
        print(f"Baixando: {item['name']}")
        download_file(url, path, item["size"])
    print(f"Concluído: {target}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, RuntimeError, urllib.error.URLError, ET.ParseError) as exc:
        print(f"ERRO: {exc}", file=sys.stderr)
        raise SystemExit(2)
