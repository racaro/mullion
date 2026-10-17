"""Cliente mínimo de la API de ComfyUI (solo biblioteca estándar de Python).

Rutas usadas (de server.py de ComfyUI): POST /upload/image, POST /prompt,
GET /history/{id}, GET /view. Es la misma pieza que usará después el backend.
"""
from __future__ import annotations

import json
import struct
import time
import uuid
from pathlib import Path
from urllib import error, parse, request


class ErrorComfy(RuntimeError):
    """Error de ComfyUI explicado en español."""


class ClienteComfy:
    def __init__(self, url: str = "http://127.0.0.1:8000", timeout: float = 30):
        self.url = url.rstrip("/")
        self.timeout = timeout

    # --- utilidades HTTP ---------------------------------------------------------
    def _peticion(self, metodo: str, ruta: str, cuerpo: bytes | None = None, cabeceras: dict | None = None) -> bytes:
        req = request.Request(self.url + ruta, data=cuerpo, method=metodo, headers=cabeceras or {})
        try:
            with request.urlopen(req, timeout=self.timeout) as r:
                return r.read()
        except error.HTTPError as e:
            raise ErrorComfy(_explicar_error(e.code, e.read())) from None
        except error.URLError as e:
            raise ErrorComfy(
                f"No puedo conectar con ComfyUI en {self.url}. ¿Está abierto? "
                "La app de escritorio suele usar el puerto 8000 y la instalación manual el 8188. "
                f"Detalle: {e.reason}"
            ) from None

    def _json(self, metodo: str, ruta: str, datos: dict | None = None) -> dict:
        cuerpo = json.dumps(datos).encode() if datos is not None else None
        cab = {"Content-Type": "application/json"} if datos is not None else {}
        return json.loads(self._peticion(metodo, ruta, cuerpo, cab) or b"{}")

    # --- API -----------------------------------------------------------------------
    def comprobar(self) -> dict:
        return self._json("GET", "/system_stats")

    def opciones(self, nodo: str, entrada: str) -> list[str]:
        """Valores permitidos de una entrada, p. ej. los modelos instalados."""
        info = self._json("GET", f"/object_info/{nodo}").get(nodo, {})
        definicion = info.get("input", {}).get("required", {}).get(entrada, [[]])
        valores = definicion[0]
        if isinstance(valores, str) and len(definicion) > 1:  # formato nuevo: ("COMBO", {"options": [...]})
            valores = definicion[1].get("options", [])
        return list(valores) if isinstance(valores, list) else []

    def subir_imagen(self, ruta: Path) -> str:
        """Sube el boceto a la carpeta input de ComfyUI y devuelve el nombre que hay que usar."""
        limite = f"----boceto{uuid.uuid4().hex}"
        datos = ruta.read_bytes()
        partes = [
            f"--{limite}\r\nContent-Disposition: form-data; name=\"overwrite\"\r\n\r\ntrue\r\n".encode(),
            (
                f"--{limite}\r\nContent-Disposition: form-data; name=\"image\"; filename=\"{ruta.name}\"\r\n"
                "Content-Type: application/octet-stream\r\n\r\n"
            ).encode()
            + datos
            + b"\r\n",
            f"--{limite}--\r\n".encode(),
        ]
        resp = json.loads(
            self._peticion("POST", "/upload/image", b"".join(partes), {"Content-Type": f"multipart/form-data; boundary={limite}"})
        )
        sub = resp.get("subfolder") or ""
        return f"{sub}/{resp['name']}" if sub else resp["name"]

    def encolar(self, flujo: dict) -> str:
        return self._json("POST", "/prompt", {"prompt": flujo, "client_id": "boceto-render"})["prompt_id"]

    def esperar(self, prompt_id: str, maximo_s: float = 900, cada_s: float = 2) -> dict:
        limite = time.monotonic() + maximo_s
        while time.monotonic() < limite:
            historial = self._json("GET", f"/history/{prompt_id}")
            if prompt_id in historial:
                entrada = historial[prompt_id]
                estado = entrada.get("status", {})
                if estado.get("status_str") == "error":
                    raise ErrorComfy(f"ComfyUI falló al generar: {_mensaje_ejecucion(estado)}")
                return entrada
            time.sleep(cada_s)
        raise ErrorComfy(f"La generación no terminó en {maximo_s:.0f} s.")

    def descargar_imagenes(self, entrada: dict, carpeta: Path, nombre: str) -> list[Path]:
        carpeta.mkdir(parents=True, exist_ok=True)
        rutas = []
        for salida in entrada.get("outputs", {}).values():
            for i, img in enumerate(salida.get("images", [])):
                q = parse.urlencode({"filename": img["filename"], "subfolder": img.get("subfolder", ""), "type": img.get("type", "output")})
                destino = carpeta / (f"{nombre}.png" if i == 0 else f"{nombre}_{i}.png")
                destino.write_bytes(self._peticion("GET", f"/view?{q}"))
                rutas.append(destino)
        if not rutas:
            raise ErrorComfy("La generación terminó pero no devolvió ninguna imagen.")
        return rutas

    def generar(self, flujo: dict, carpeta: Path, nombre: str) -> list[Path]:
        return self.descargar_imagenes(self.esperar(self.encolar(flujo)), carpeta, nombre)


def _explicar_error(codigo: int, cuerpo: bytes) -> str:
    try:
        datos = json.loads(cuerpo)
    except ValueError:
        return f"ComfyUI respondió {codigo}: {cuerpo[:300].decode(errors='replace')}"
    lineas = [f"ComfyUI rechazó la petición ({codigo}): {datos.get('error', {}).get('message', '')}".strip()]
    for nodo, info in (datos.get("node_errors") or {}).items():
        for err in info.get("errors", []):
            detalle = err.get("details") or err.get("message")
            lineas.append(f"  · Nodo {nodo} ({info.get('class_type', '?')}): {detalle}")
    if any("not in" in l or "Value not in list" in l for l in lineas):
        lineas.append("  Pista: el nombre del modelo o del ControlNet no coincide con un archivo de tu ComfyUI.")
    return "\n".join(lineas)


def _mensaje_ejecucion(estado: dict) -> str:
    for tipo, datos in estado.get("messages", []):
        if tipo == "execution_error":
            return f"{datos.get('node_type', '?')}: {datos.get('exception_message', '').strip()}"
    return "error desconocido"


def medidas_imagen(ruta: Path) -> tuple[int, int]:
    """Ancho y alto de un PNG o JPEG leyendo la cabecera (sin librerías externas)."""
    datos = ruta.read_bytes()
    if datos[:8] == b"\x89PNG\r\n\x1a\n":
        return struct.unpack(">II", datos[16:24])
    if datos[:2] == b"\xff\xd8":
        i = 2
        while i + 9 < len(datos):
            if datos[i] != 0xFF:
                i += 1
                continue
            marca = datos[i + 1]
            if marca in (0xD8, 0x01) or 0xD0 <= marca <= 0xD7:
                i += 2
                continue
            largo = struct.unpack(">H", datos[i + 2 : i + 4])[0]
            if 0xC0 <= marca <= 0xCF and marca not in (0xC4, 0xC8, 0xCC):
                alto, ancho = struct.unpack(">HH", datos[i + 5 : i + 9])
                return ancho, alto
            i += 2 + largo
    raise ValueError(f"{ruta.name}: formato no soportado. Usa PNG o JPG.")
