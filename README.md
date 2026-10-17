# Boceto a render

Herramienta para interioristas: subes un boceto, un asistente te ayuda a describirlo y obtienes vistas realistas que respetan la composición.

Nombre provisional hasta decidir la marca.

## Arquitectura

```
Navegador → Worker de Cloudflare (panel + API + login con Google) → D1 / R2
                     ↓ Queue
               Cloudflare Tunnel → ComfyUI (Mac mini en el piloto, GPU en la nube después)
```

## Estado

| Paso | Carpeta | Estado |
| --- | --- | --- |
| 1. Validar el motor de render | `motor/` | Listo para probar en el Mac |
| 2. Base: panel, login, D1, R2, cola | `web/` | Pendiente del resultado del paso 1 |
| 3. Asistente que crea el prompt | `web/` | Pendiente |
| 4. Producto y piloto | | Pendiente |
