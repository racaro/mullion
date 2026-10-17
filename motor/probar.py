"""Batería de pruebas del motor: ¿respeta el boceto?

Genera varias imágenes del mismo boceto cambiando una sola cosa cada vez (fuerza del
ControlNet, tipo de ControlNet y materiales) con la misma semilla, y crea una página
comparativa.html para verlas juntas.

Uso (con ComfyUI abierto):
    python probar.py --listar
    python probar.py --boceto boceto_carmen.jpg --modelo <archivo> --controlnet <archivo>
"""
from __future__ import annotations

import argparse
import html
import sys
import time
from pathlib import Path

from cliente import ClienteComfy, ErrorComfy, medidas_imagen
from flujo import ParametrosRender, construir_flujo, medidas_para
from plantilla import ESTANCIAS, ESTILOS, LUCES, MATERIALES, Ficha, FichaInvalida, construir_prompt


def lista(texto: str) -> list[str]:
    return [t.strip() for t in texto.split(",") if t.strip()]


def argumentos() -> argparse.Namespace:
    a = argparse.ArgumentParser(description="Prueba boceto → render con ComfyUI")
    a.add_argument("--url", default="http://127.0.0.1:8000", help="Dirección de ComfyUI (app de escritorio: 8000; manual: 8188)")
    a.add_argument("--listar", action="store_true", help="Muestra los modelos y ControlNet instalados y termina")
    a.add_argument("--boceto", type=Path, help="Imagen del boceto (PNG o JPG)")
    a.add_argument("--modelo", help="Archivo del modelo base (models/checkpoints)")
    a.add_argument("--controlnet", type=lista, help="Uno o varios archivos ControlNet separados por comas")
    a.add_argument("--fuerzas", type=lambda t: [float(x) for x in lista(t)], default=[0.6, 0.8, 1.0])
    a.add_argument("--semilla", type=int, default=42)
    a.add_argument("--pasos", type=int, default=25)
    a.add_argument("--estancia", default="salon", choices=sorted(ESTANCIAS))
    a.add_argument("--estilo", default="nordico", choices=sorted(ESTILOS))
    a.add_argument("--luz", default="manana", choices=sorted(LUCES))
    a.add_argument("--materiales", type=lista, default=["suelo_roble", "paredes_blancas"])
    a.add_argument("--materiales-b", type=lista, default=["suelo_marmol", "paredes_cal"],
                   help="Segunda combinación, para ver si cambiar materiales mantiene la composición")
    a.add_argument("--sin-invertir", action="store_true", help="Úsalo si tu boceto ya tiene líneas blancas sobre fondo negro")
    a.add_argument("--salida", type=Path, default=Path("resultados"))
    return a.parse_args()


def listar(cliente: ClienteComfy) -> None:
    modelos = cliente.opciones("CheckpointLoaderSimple", "ckpt_name")
    controlnets = cliente.opciones("ControlNetLoader", "control_net_name")
    print("Modelos base instalados:")
    print("\n".join(f"  · {m}" for m in modelos) or "  (ninguno: descarga uno con el Manager)")
    print("ControlNet instalados:")
    print("\n".join(f"  · {c}" for c in controlnets) or "  (ninguno: descarga uno con el Manager)")


def validar_nombres(cliente: ClienteComfy, modelo: str, controlnets: list[str]) -> None:
    modelos = cliente.opciones("CheckpointLoaderSimple", "ckpt_name")
    disponibles = cliente.opciones("ControlNetLoader", "control_net_name")
    faltan = ([modelo] if modelo not in modelos else []) + [c for c in controlnets if c not in disponibles]
    if faltan:
        raise SystemExit("No encuentro en ComfyUI: " + ", ".join(faltan) + ". Ejecuta con --listar para ver los nombres exactos.")


def pagina(filas: list[dict], boceto: str, prompt_a: str, prompt_b: str) -> str:
    tarjetas = "\n".join(
        f"""<figure><img src="{html.escape(f['imagen'])}" alt=""><figcaption>
<b>{html.escape(f['controlnet'])}</b><br>fuerza {f['fuerza']} · materiales {f['variante']} · {f['segundos']:.0f} s</figcaption></figure>"""
        for f in filas
    )
    return f"""<!doctype html><html lang="es"><meta charset="utf-8"><title>Comparativa boceto → render</title>
<style>body{{font:15px/1.5 -apple-system,Segoe UI,sans-serif;margin:24px;background:#f6f6f4;color:#1d1d1b}}
.grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px}}
figure{{margin:0;background:#fff;border:1px solid #ddd;border-radius:8px;overflow:hidden}}
img{{width:100%;display:block}} figcaption{{padding:8px 12px;font-size:13px}} code{{font-size:12px}}</style>
<h1>Comparativa boceto → render</h1>
<p>Misma semilla en todas. Busca si los muebles, huecos y ventanas siguen donde están en el boceto.</p>
<div class="grid"><figure><img src="{html.escape(boceto)}" alt=""><figcaption><b>Boceto original</b></figcaption></figure>
{tarjetas}</div>
<h2>Prompts</h2><p><b>A:</b> <code>{html.escape(prompt_a)}</code></p><p><b>B:</b> <code>{html.escape(prompt_b)}</code></p></html>"""


def main() -> int:
    args = argumentos()
    cliente = ClienteComfy(args.url)
    try:
        cliente.comprobar()
        if args.listar:
            listar(cliente)
            return 0
        if not (args.boceto and args.modelo and args.controlnet):
            print("Faltan --boceto, --modelo y --controlnet (usa --listar para ver los nombres).", file=sys.stderr)
            return 2
        validar_nombres(cliente, args.modelo, args.controlnet)

        ficha_a = Ficha(args.estancia, args.estilo, args.luz, args.materiales)
        ficha_b = Ficha(args.estancia, args.estilo, args.luz, args.materiales_b)
        prompt_a, negativo = construir_prompt(ficha_a)
        prompt_b, _ = construir_prompt(ficha_b)

        ancho, alto = medidas_para(*medidas_imagen(args.boceto))
        nombre_subido = cliente.subir_imagen(args.boceto)
        args.salida.mkdir(parents=True, exist_ok=True)
        (args.salida / args.boceto.name).write_bytes(args.boceto.read_bytes())

        combinaciones = [
            (cn, fuerza, variante, prompt)
            for cn in args.controlnet
            for fuerza in args.fuerzas
            for variante, prompt in (("A", prompt_a), ("B", prompt_b))
        ]
        print(f"Boceto {args.boceto.name} → {ancho}×{alto} px. {len(combinaciones)} imágenes a generar.")
        filas = []
        for n, (cn, fuerza, variante, prompt) in enumerate(combinaciones, 1):
            nombre = f"{Path(cn).stem}_f{fuerza:.2f}_{variante}"
            flujo = construir_flujo(ParametrosRender(
                imagen_boceto=nombre_subido, modelo=args.modelo, controlnet=cn, positivo=prompt, negativo=negativo,
                ancho=ancho, alto=alto, semilla=args.semilla, fuerza_controlnet=fuerza, pasos=args.pasos,
                invertir_boceto=not args.sin_invertir, prefijo_salida=f"prueba/{nombre}",
            ))
            inicio = time.monotonic()
            ruta = cliente.generar(flujo, args.salida, nombre)[0]
            segundos = time.monotonic() - inicio
            print(f"  [{n}/{len(combinaciones)}] {nombre}: {segundos:.0f} s")
            filas.append({"imagen": ruta.name, "controlnet": cn, "fuerza": fuerza, "variante": variante, "segundos": segundos})
            (args.salida / "comparativa.html").write_text(pagina(filas, args.boceto.name, prompt_a, prompt_b), encoding="utf-8")

        print(f"Listo. Abre {args.salida / 'comparativa.html'}")
        return 0
    except (ErrorComfy, FichaInvalida, ValueError) as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
