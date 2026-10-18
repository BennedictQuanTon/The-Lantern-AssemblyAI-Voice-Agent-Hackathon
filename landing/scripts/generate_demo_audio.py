"""Generate the audio for the landing page's feature demos.

The waiter speaks with the product's own Kokoro voices (``providers/tts/kokoro.py``: af_heart for
English, ef_dora for Spanish) and says the replies verbatim: the six-turn and Spanish lines come
from ``docs/demo/DEMO_SCRIPT.md`` (rehearsed on the live stack), and the allergy and kitchen lines
come from running ``RealtimeSession`` and ``response_renderer``. Guests use other Kokoro voices so
the two speakers are easy to tell apart. The "one moment" clips are the app's real fillers.

    .venv/bin/python landing/scripts/generate_demo_audio.py

Writes MP3s and ``manifest.json`` to ``landing/public/audio/demo/``.
"""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
import soundfile as sf

ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = ROOT / "landing" / "public" / "audio" / "demo"
FILLER_DIR = ROOT / "frontend" / "public" / "audio" / "fillers"
SAMPLE_RATE = 24000

# speaker -> (Kokoro lang code, voice)
VOICES = {
    "guest_en": ("a", "am_michael"),
    "guest_es": ("e", "em_alex"),
    "waiter_en": ("a", "af_heart"),
    "waiter_es": ("e", "ef_dora"),
}

# clip id -> (speaker, text)
CLIPS = {
    # Memory: "those two"
    "g_recommend": ("guest_en", "What would you recommend for a mild couple?"),
    "w_recommend": ("waiter_en", "I recommend Pomelo Salad with Shrimp ($6.50), Lemongrass Chicken ($9.00)."),
    "g_those_two": ("guest_en", "We'll take those two, please."),
    "w_those_two": ("waiter_en", "Your order now includes 1 Pomelo Salad with Shrimp, 1 Lemongrass Chicken. Total: $15.50. Tell me when you'd like me to place it."),
    # Sold out: "instead"
    "g_squid": ("guest_en", "I'd like the crispy squid too."),
    "w_squid": ("waiter_en", "Crispy Squid is sold out. Would you like Grilled Seabass instead?"),
    "g_instead": ("guest_en", "Okay, make it a grilled seabass instead."),
    "w_instead": ("waiter_en", "Your order now includes 1 Pomelo Salad with Shrimp, 1 Lemongrass Chicken, 1 Grilled Seabass. Total: $31.50. Tell me when you'd like me to place it."),
    # Allergy guard
    "g_allergy": ("guest_en", "I'm allergic to peanuts. One grilled seabass, please."),
    "w_allergy": ("waiter_en", "Your order now includes 1 Grilled Seabass. Total: $16.00. Tell me when you'd like me to place it."),
    "g_pomelo": ("guest_en", "And the pomelo salad."),
    "w_pomelo": ("waiter_en", "Pomelo Salad with Shrimp contains peanut, which you're avoiding. Would you like something else?"),
    # Place the order and the kitchen loop
    "g_place": ("guest_en", "That's all, please place the order."),
    "w_place": ("waiter_en", "Your order is in: 1 Pomelo Salad with Shrimp, 1 Lemongrass Chicken, 1 Grilled Seabass, 1 Stir-fried Morning Glory. Total: $36.50. I sent it to the kitchen."),
    "w_kitchen_accept": ("waiter_en", "The kitchen confirmed your order."),
    "w_kitchen_ready": ("waiter_en", "Your order is ready."),
    # Spanish
    "g_es_recommend": ("guest_es", "¿Qué nos recomienda para una pareja, algo suave?"),
    "w_es_recommend": ("waiter_es", "Le recomiendo Pomelo Salad with Shrimp ($6.50), Lemongrass Chicken ($9.00)."),
    "g_es_those_two": ("guest_es", "Queremos esos dos, por favor."),
    "w_es_those_two": ("waiter_es", "Su pedido ahora incluye 1 Pomelo Salad with Shrimp, 1 Lemongrass Chicken. Total: $15.50. Avíseme cuando quiera que lo envíe."),
    "g_es_place": ("guest_es", "Eso es todo, envíe el pedido, por favor."),
    "w_es_place": ("waiter_es", "Su pedido quedó registrado: 1 Pomelo Salad with Shrimp, 1 Lemongrass Chicken. Total: $15.50. Lo envié a la cocina."),
    # Barge-in: the guest talks over a long readback
    "w_side": ("waiter_en", "Your order now includes 1 Pomelo Salad with Shrimp, 1 Lemongrass Chicken, 1 Grilled Seabass, 1 Stir-fried Morning Glory. Total: $36.50. Tell me when you'd like me to place it."),
    "g_barge": ("guest_en", "Sorry, one more thing."),
}

FILLERS = ["recommend_en", "order_en", "check_en", "place_en", "generic_es"]


def trim_silence(audio: np.ndarray, threshold: float = 0.01, pad_seconds: float = 0.06) -> np.ndarray:
    loud = np.flatnonzero(np.abs(audio) > threshold)
    if loud.size == 0:
        return audio
    pad = int(pad_seconds * SAMPLE_RATE)
    return audio[max(0, loud[0] - pad): loud[-1] + pad]


def to_mp3(wav: Path, mp3: Path) -> None:
    subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(wav), "-ac", "1", "-ar", "24000",
         "-c:a", "libmp3lame", "-b:a", "64k", str(mp3)],
        check=True,
    )


def main() -> None:
    from kokoro import KPipeline

    if not shutil.which("ffmpeg"):
        sys.exit("ffmpeg is required")
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    pipelines: dict[str, KPipeline] = {}
    manifest: dict[str, dict] = {}

    with tempfile.TemporaryDirectory() as tmp:
        for clip_id, (speaker, text) in CLIPS.items():
            lang_code, voice = VOICES[speaker]
            pipeline = pipelines.setdefault(lang_code, KPipeline(lang_code=lang_code, repo_id="hexgrad/Kokoro-82M", device="cpu"))
            audio = trim_silence(np.concatenate([np.asarray(r.audio, dtype=np.float32) for r in pipeline(text, voice=voice)]))
            wav = Path(tmp) / f"{clip_id}.wav"
            sf.write(wav, audio, SAMPLE_RATE, subtype="PCM_16")
            to_mp3(wav, OUT_DIR / f"{clip_id}.mp3")
            manifest[clip_id] = {"speaker": speaker, "voice": voice, "text": text, "seconds": round(len(audio) / SAMPLE_RATE, 2)}
            print(f"{clip_id:18s} {manifest[clip_id]['seconds']:5.2f}s  {text}")

        filler_meta = json.loads((FILLER_DIR / "manifest.json").read_text())
        for clip_id in FILLERS:
            to_mp3(FILLER_DIR / f"{clip_id}.wav", OUT_DIR / f"f_{clip_id}.mp3")
            meta = filler_meta[clip_id]
            manifest[f"f_{clip_id}"] = {"speaker": "filler", "voice": meta["voice"], "text": meta["text"], "seconds": meta["seconds"]}

    (OUT_DIR / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")
    print(f"wrote {len(manifest)} clips to {OUT_DIR}")


if __name__ == "__main__":
    main()
