# Step 1 · Validate the render engine

Goal: check, with a real client sketch, whether ComfyUI with ControlNet **keeps the layout** (furniture, doors, windows) when turning it into a photorealistic view. If it does not, there is no point building the rest.

Time: about 45 minutes the first time (mostly model downloads). Cost: €0.

## 1. Install ComfyUI

1. Download the desktop app for Mac from **comfy.org/download** and install it.
2. Open it. On first launch it sets up its Python environment, which takes a few minutes.
3. Keep it open during the whole test.

## 2. Download the models

In the app: **Manager → Model Manager**. Search for and install:

| What | Search for | Folder |
| --- | --- | --- |
| Base model (Stable Diffusion 1.5) | `v1-5-pruned-emaonly` | `checkpoints` |
| ControlNet for clean line drawings | `control_v11p_sd15_lineart` | `controlnet` |
| ControlNet for scribbles (more forgiving with hand sketches) | `control_v11p_sd15_scribble` | `controlnet` |

About 6 GB in total. We start with Stable Diffusion 1.5 because it runs fast on a Mac and its licence (CreativeML OpenRAIL-M) allows commercial use with usage restrictions. We will review the licence of the final model before charging customers.

If the ControlNets are not listed in the Model Manager, they are on Hugging Face in `lllyasviel/ControlNet-v1-1`; copy them into ComfyUI's `models/controlnet` folder.

## 3. Prepare the sketch

- Photo or scan taken **straight on, without shadows**, cropped to the drawing.
- Dark lines on light paper (the bench inverts it for you). If your sketch is already white on black, add `--no-invert`.
- PNG or JPG, any size: the bench resizes it and keeps the aspect ratio.

## 4. Run the bench

In Terminal, inside this folder (`engine`):

```bash
# 1) See the exact names of what is installed
python3 bench.py --list

# 2) Run the bench (use the names --list showed you)
python3 bench.py \
  --sketch ~/Desktop/sketch.jpg \
  --checkpoint v1-5-pruned-emaonly.safetensors \
  --controlnet control_v11p_sd15_lineart.pth,control_v11p_sd15_scribble.pth
```

It renders **12 images**: 2 ControlNets × 3 strengths (0.6 · 0.8 · 1.0) × 2 material sets, all with the same seed. Expect 5 to 15 minutes.

If it cannot connect, try `--url http://127.0.0.1:8188` (the desktop app usually uses port 8000; a manual install uses 8188).

Useful options: `--room kitchen`, `--style industrial`, `--lighting golden_hour`, `--materials floor_microcement,metal_black`. Run `python3 bench.py --help` for all of them.

## 5. Evaluate

Open `results/comparison.html`. For each image, check:

| Question | What to look for |
| --- | --- |
| Does it keep the layout? | Furniture, doors and windows where the sketch puts them |
| Are lines straight? | Walls and corners not warped |
| Does changing materials keep everything else? | Compare A and B with the same ControlNet and strength: only floor and walls should change |
| Could you show it to a client? | Overall quality, no smudges or invented objects |

**Decision:**
- A combination passes all four → note which one (ControlNet and strength) and move to step 2.
- Layout is right but quality is poor → try a photorealistic base model or SDXL.
- No combination keeps the layout → try the straight-line ControlNet (MLSD) or a line preprocessor before dropping the idea.

## What is here

| File | Purpose |
| --- | --- |
| `brief.py` | Room brief (room, style, materials, lighting) → technical prompt; option labels in English and Spanish |
| `workflow.py` | ComfyUI workflow with ControlNet, built only from stock nodes |
| `client.py` | ComfyUI API client; the backend will reuse it |
| `bench.py` | The bench and its comparison page |
| `tests/` | 19 tests with a fake ComfyUI that validates the workflow against the real node signatures |

Standard library only, Python 3.9 or newer (the one that ships with macOS works). To run the tests: `pip3 install pytest && python3 -m pytest`.
