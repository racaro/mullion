# Paso 1 · Validar el motor de render

Objetivo: comprobar con un boceto real de Carmen si ComfyUI con ControlNet **mantiene la composición** (muebles, huecos, ventanas) al convertirlo en una vista realista. Si no lo hace, no tiene sentido construir lo demás.

Duración: unos 45 minutos la primera vez (casi todo es descarga de modelos). Coste: 0 €.

## 1. Instalar ComfyUI

1. Descarga la app de escritorio para Mac en **comfy.org/download** e instálala.
2. Ábrela. La primera vez prepara su entorno de Python; tarda unos minutos.
3. Déjala abierta durante toda la prueba.

## 2. Descargar los modelos

Desde la app: botón **Manager → Model Manager**. Busca e instala:

| Qué | Busca | Carpeta |
| --- | --- | --- |
| Modelo base (Stable Diffusion 1.5) | `v1-5-pruned-emaonly` | `checkpoints` |
| ControlNet de trazos limpios | `control_v11p_sd15_lineart` | `controlnet` |
| ControlNet de garabato (más tolerante con bocetos a mano) | `control_v11p_sd15_scribble` | `controlnet` |

Ocupan unos 6 GB en total. Empezamos con Stable Diffusion 1.5 porque es rápido en el Mac y su licencia (CreativeML OpenRAIL-M) permite uso comercial con restricciones de uso. Antes de cobrar a clientes revisaremos la licencia del modelo definitivo.

Si no aparecen en el Model Manager, los ControlNet están en Hugging Face, en el repositorio `lllyasviel/ControlNet-v1-1`; se copian a la carpeta `models/controlnet` de ComfyUI.

## 3. Preparar el boceto

- Foto o escaneo **de frente, sin sombras**, recortado al dibujo.
- Líneas oscuras sobre papel claro (el script lo invierte solo). Si tu boceto ya es blanco sobre negro, añade `--sin-invertir`.
- PNG o JPG. El tamaño da igual: el script lo ajusta manteniendo la proporción.

## 4. Lanzar la prueba

En Terminal, dentro de esta carpeta (`motor`):

```bash
# 1) Ver los nombres exactos de lo instalado
python3 probar.py --listar

# 2) Lanzar la batería (cambia los nombres por los que te haya mostrado --listar)
python3 probar.py \
  --boceto ~/Desktop/boceto_carmen.jpg \
  --modelo v1-5-pruned-emaonly.safetensors \
  --controlnet control_v11p_sd15_lineart.pth,control_v11p_sd15_scribble.pth
```

Genera **12 imágenes**: 2 ControlNet × 3 fuerzas (0,6 · 0,8 · 1,0) × 2 combinaciones de materiales, todas con la misma semilla. Calcula entre 5 y 15 minutos.

Si no conecta, prueba `--url http://127.0.0.1:8188` (la app de escritorio suele usar el puerto 8000 y la instalación manual el 8188).

Opciones útiles: `--estancia cocina`, `--estilo industrial`, `--luz tarde`, `--materiales suelo_microcemento,metal_negro`. Con `python3 probar.py --help` ves todas.

## 5. Evaluar

Abre `resultados/comparativa.html`. Para cada imagen, marca:

| Pregunta | Qué buscar |
| --- | --- |
| ¿Respeta la composición? | Muebles, puertas y ventanas en el mismo sitio que en el boceto |
| ¿Las líneas son rectas? | Paredes y esquinas sin deformar |
| ¿Cambiar materiales mantiene todo lo demás? | Compara A y B con el mismo ControlNet y fuerza: solo debería cambiar el suelo y las paredes |
| ¿Es presentable a un cliente? | Calidad general, sin manchas ni objetos inventados |

**Decisión:**
- Alguna combinación cumple las cuatro → apunta cuál (ControlNet y fuerza) y pasamos al paso 2.
- Respeta la composición pero la calidad es pobre → probamos un modelo base fotorrealista o SDXL.
- No respeta la composición con ninguna → probamos el ControlNet de líneas rectas (MLSD) o un preprocesador de líneas antes de abandonar la idea.

Mándame la `comparativa.html` o capturas y lo analizamos juntos.

## Qué hay aquí

| Archivo | Para qué |
| --- | --- |
| `plantilla.py` | Ficha en español (estancia, estilo, materiales, luz) → prompt técnico en inglés |
| `flujo.py` | Flujo de ComfyUI con ControlNet, solo con nodos de serie |
| `cliente.py` | Cliente de la API de ComfyUI; lo reutilizará el backend |
| `probar.py` | La batería de pruebas y la página comparativa |
| `tests/` | 17 pruebas con un ComfyUI simulado que valida el flujo con las firmas reales de los nodos |

Solo usa la biblioteca estándar de Python (3.9 o superior, el que trae macOS sirve). Para las pruebas: `pip3 install pytest && python3 -m pytest`.
