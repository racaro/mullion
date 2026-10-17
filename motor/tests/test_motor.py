"""Pruebas del motor sin GPU ni modelos.

Un ComfyUI simulado valida el flujo con las firmas reales de los nodos (sacadas de
nodes.py de ComfyUI, ver firmas_comfyui.json) y responde como la API de verdad.
"""
from __future__ import annotations

import json
import struct
import sys
import threading
import zlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ))

from cliente import ClienteComfy, ErrorComfy, medidas_imagen  # noqa: E402
from flujo import ParametrosRender, construir_flujo, medidas_para  # noqa: E402
from plantilla import NEGATIVO, Ficha, FichaInvalida, construir_prompt  # noqa: E402

FIRMAS = {k: v for k, v in json.loads((Path(__file__).parent / "firmas_comfyui.json").read_text()).items() if not k.startswith("_")}
VALORES = {  # valores permitidos de los desplegables, copiados de ComfyUI
    ("ImageScale", "upscale_method"): ["nearest-exact", "bilinear", "area", "bicubic", "lanczos"],
    ("ImageScale", "crop"): ["disabled", "center"],
    ("KSampler", "sampler_name"): ["euler", "euler_ancestral", "dpmpp_2m", "dpmpp_2m_sde", "dpmpp_3m_sde"],
    ("KSampler", "scheduler"): ["normal", "karras", "exponential", "sgm_uniform", "simple"],
}
MODELOS = ["realisticVision_v51.safetensors"]
CONTROLNETS = ["control_v11p_sd15_lineart.pth", "control_v11p_sd15_scribble.pth"]


def png(ancho: int, alto: int) -> bytes:
    fila = b"\x00" + b"\xff\xff\xff" * ancho
    bloque = lambda t, d: struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d))  # noqa: E731
    return (b"\x89PNG\r\n\x1a\n" + bloque(b"IHDR", struct.pack(">IIBBBBB", ancho, alto, 8, 2, 0, 0, 0))
            + bloque(b"IDAT", zlib.compress(fila * alto)) + bloque(b"IEND", b""))


# ---------- validador con las firmas reales ----------------------------------------
def validar(flujo: dict) -> list[str]:
    errores = []
    for nid, nodo in flujo.items():
        firma = FIRMAS.get(nodo["class_type"])
        if not firma:
            errores.append(f"{nid}: nodo desconocido {nodo['class_type']}")
            continue
        entradas = nodo["inputs"]
        for nombre in firma["required"]:
            if nombre not in entradas:
                errores.append(f"{nid}: falta {nombre}")
        for nombre, valor in entradas.items():
            tipo_esperado = firma["required"].get(nombre) or firma["optional"].get(nombre)
            if tipo_esperado is None:
                errores.append(f"{nid}: entrada que no existe {nombre}")
                continue
            if isinstance(valor, list):  # conexión ["id", salida]
                origen = flujo.get(valor[0])
                if origen is None:
                    errores.append(f"{nid}.{nombre}: conecta con nodo inexistente {valor[0]}")
                    continue
                salidas = FIRMAS[origen["class_type"]]["returns"]
                if valor[1] >= len(salidas) or salidas[valor[1]] != tipo_esperado:
                    errores.append(f"{nid}.{nombre}: espera {tipo_esperado}, recibe {salidas[valor[1]] if valor[1] < len(salidas) else '?'}")
            elif (nodo["class_type"], nombre) in VALORES and valor not in VALORES[(nodo["class_type"], nombre)]:
                errores.append(f"{nid}.{nombre}: valor no permitido {valor}")
    return errores


class ComfySimulado(BaseHTTPRequestHandler):
    recibidos: list[dict] = []
    fallar_ejecucion = False

    def log_message(self, *a):  # silencio
        pass

    def _responder(self, codigo: int, datos, tipo="application/json"):
        cuerpo = datos if isinstance(datos, bytes) else json.dumps(datos).encode()
        self.send_response(codigo)
        self.send_header("Content-Type", tipo)
        self.send_header("Content-Length", str(len(cuerpo)))
        self.end_headers()
        self.wfile.write(cuerpo)

    def do_GET(self):
        if self.path == "/system_stats":
            return self._responder(200, {"system": {"os": "darwin"}})
        if self.path.startswith("/object_info/"):
            nodo = self.path.rsplit("/", 1)[1]
            opciones = {"CheckpointLoaderSimple": ("ckpt_name", MODELOS), "ControlNetLoader": ("control_net_name", CONTROLNETS)}[nodo]
            return self._responder(200, {nodo: {"input": {"required": {opciones[0]: [opciones[1], {}]}}}})
        if self.path.startswith("/history/"):
            pid = self.path.rsplit("/", 1)[1]
            if ComfySimulado.fallar_ejecucion:
                return self._responder(200, {pid: {"status": {"status_str": "error", "messages": [
                    ["execution_error", {"node_type": "KSampler", "exception_message": "MPS backend out of memory"}]]}}})
            return self._responder(200, {pid: {"status": {"status_str": "success"},
                                               "outputs": {"12": {"images": [{"filename": "x_00001_.png", "subfolder": "prueba", "type": "output"}]}}}})
        if self.path.startswith("/view?"):
            return self._responder(200, png(8, 8), "image/png")
        self._responder(404, {})

    def do_POST(self):
        cuerpo = self.rfile.read(int(self.headers["Content-Length"]))
        if self.path == "/upload/image":
            assert b'name="image"; filename="boceto.png"' in cuerpo
            return self._responder(200, {"name": "boceto.png", "subfolder": "", "type": "input"})
        if self.path == "/prompt":
            datos = json.loads(cuerpo)
            flujo = datos["prompt"]
            for nodo in flujo.values():  # comprobación de archivos, como hace ComfyUI
                i = nodo["inputs"]
                if nodo["class_type"] == "CheckpointLoaderSimple" and i["ckpt_name"] not in MODELOS:
                    return self._responder(400, {"error": {"message": "Prompt outputs failed validation"}, "node_errors": {
                        "1": {"class_type": "CheckpointLoaderSimple", "errors": [{"message": "Value not in list", "details": f"ckpt_name: '{i['ckpt_name']}' not in list"}]}}})
            errores = validar(flujo)
            if errores:
                return self._responder(400, {"error": {"message": "; ".join(errores)}, "node_errors": {}})
            ComfySimulado.recibidos.append(flujo)
            return self._responder(200, {"prompt_id": f"id-{len(ComfySimulado.recibidos)}"})
        self._responder(404, {})


@pytest.fixture
def servidor():
    ComfySimulado.recibidos = []
    ComfySimulado.fallar_ejecucion = False
    srv = ThreadingHTTPServer(("127.0.0.1", 0), ComfySimulado)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{srv.server_address[1]}"
    srv.shutdown()


def parametros(**cambios) -> ParametrosRender:
    base = dict(imagen_boceto="boceto.png", modelo=MODELOS[0], controlnet=CONTROLNETS[0],
                positivo="living room", negativo=NEGATIVO, ancho=768, alto=512)
    return ParametrosRender(**{**base, **cambios})


# ---------- plantilla ---------------------------------------------------------------
def test_prompt_traduce_y_ordena():
    pos, neg = construir_prompt(Ficha("salon", "nordico", "tarde", ["suelo_roble", "paredes_blancas"]))
    assert pos.startswith("photorealistic interior design photography")
    assert pos.index("living room") < pos.index("scandinavian") < pos.index("light oak") < pos.index("golden hour")
    assert pos.endswith("sharp focus")
    assert "blurry" in neg


def test_prompt_sin_materiales_duplicados_y_con_detalles():
    pos, _ = construir_prompt(Ficha("cocina", "industrial", materiales=["metal_negro", "metal_negro"], detalles_en="island with stools"))
    assert pos.count("matte black metal") == 1
    assert "island with stools" in pos


def test_ficha_invalida_explica_opciones():
    with pytest.raises(FichaInvalida, match="estilo «gotico» no existe.*nordico"):
        construir_prompt(Ficha("salon", "gotico"))
    with pytest.raises(FichaInvalida, match="material"):
        construir_prompt(Ficha("salon", "nordico", materiales=["oro"]))


# ---------- flujo -------------------------------------------------------------------
def test_flujo_valido_con_firmas_reales():
    assert validar(construir_flujo(parametros())) == []


def test_flujo_sin_invertir_sigue_siendo_valido():
    flujo = construir_flujo(parametros(invertir_boceto=False))
    assert "4" not in flujo
    assert flujo["8"]["inputs"]["image"] == ["3", 0]
    assert validar(flujo) == []


def test_flujo_pasa_parametros():
    f = construir_flujo(parametros(semilla=7, fuerza_controlnet=0.6, ancho=512, alto=768))
    assert f["10"]["inputs"]["seed"] == 7
    assert f["8"]["inputs"]["strength"] == 0.6
    assert (f["9"]["inputs"]["width"], f["9"]["inputs"]["height"]) == (512, 768)
    assert (f["3"]["inputs"]["width"], f["3"]["inputs"]["height"]) == (512, 768)


def test_flujo_rechaza_medidas_no_multiplo_de_8():
    with pytest.raises(ValueError):
        construir_flujo(parametros(ancho=770))


@pytest.mark.parametrize("original,esperado", [((1600, 1200), (768, 576)), ((1080, 1920), (432, 768)), ((800, 800), (768, 768))])
def test_medidas_mantienen_proporcion(original, esperado):
    assert medidas_para(*original) == esperado


def test_medidas_imagen_png_y_jpeg(tmp_path):
    p = tmp_path / "a.png"
    p.write_bytes(png(1600, 1200))
    assert medidas_imagen(p) == (1600, 1200)
    j = tmp_path / "a.jpg"  # JPEG mínimo: SOI + APP0 + SOF0 (alto 300, ancho 400)
    j.write_bytes(b"\xff\xd8" + b"\xff\xe0\x00\x10" + b"JFIF\x00" + b"\x00" * 9 + b"\xff\xc0\x00\x11\x08\x01\x2c\x01\x90" + b"\x00" * 10)
    assert medidas_imagen(j) == (400, 300)


# ---------- cliente contra ComfyUI simulado -----------------------------------------
def test_ciclo_completo(servidor, tmp_path):
    boceto = tmp_path / "boceto.png"
    boceto.write_bytes(png(1600, 1200))
    c = ClienteComfy(servidor)
    assert c.opciones("ControlNetLoader", "control_net_name") == CONTROLNETS
    nombre = c.subir_imagen(boceto)
    rutas = c.generar(construir_flujo(parametros(imagen_boceto=nombre)), tmp_path / "out", "prueba")
    assert rutas[0].read_bytes().startswith(b"\x89PNG")
    assert ComfySimulado.recibidos[0]["2"]["inputs"]["image"] == "boceto.png"


def test_error_de_validacion_en_espanol(servidor):
    with pytest.raises(ErrorComfy, match="Nodo 1.*not in list(.|\n)*Pista: el nombre del modelo"):
        ClienteComfy(servidor).encolar(construir_flujo(parametros(modelo="no_existe.safetensors")))


def test_error_de_ejecucion_explicado(servidor):
    ComfySimulado.fallar_ejecucion = True
    with pytest.raises(ErrorComfy, match="KSampler: MPS backend out of memory"):
        ClienteComfy(servidor).esperar("id-1", cada_s=0.01)


def test_sin_conexion_da_pista_del_puerto():
    with pytest.raises(ErrorComfy, match="puerto 8000"):
        ClienteComfy("http://127.0.0.1:9", timeout=1).comprobar()


def test_script_completo(servidor, tmp_path, monkeypatch):
    import probar

    boceto = tmp_path / "boceto.png"
    boceto.write_bytes(png(1600, 1200))
    salida = tmp_path / "res"
    monkeypatch.setattr(sys, "argv", ["probar.py", "--url", servidor, "--boceto", str(boceto), "--modelo", MODELOS[0],
                                      "--controlnet", ",".join(CONTROLNETS), "--fuerzas", "0.8,1.0", "--salida", str(salida)])
    assert probar.main() == 0
    assert len(ComfySimulado.recibidos) == 2 * 2 * 2  # 2 ControlNet × 2 fuerzas × 2 combinaciones de materiales
    assert {f["10"]["inputs"]["seed"] for f in ComfySimulado.recibidos} == {42}  # misma semilla en todas
    html = (salida / "comparativa.html").read_text()
    assert html.count("<figure>") == 9 and "Boceto original" in html


def test_script_avisa_si_falta_un_controlnet(servidor, tmp_path, monkeypatch):
    import probar

    boceto = tmp_path / "boceto.png"
    boceto.write_bytes(png(100, 100))
    monkeypatch.setattr(sys, "argv", ["probar.py", "--url", servidor, "--boceto", str(boceto), "--modelo", MODELOS[0], "--controlnet", "otro.pth"])
    with pytest.raises(SystemExit, match="otro.pth"):
        probar.main()
