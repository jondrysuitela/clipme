"""
translate.py — Offline translation via Argos Translate (NMT, CTranslate2).

No API key, no subscription. Models are downloaded once into the user's
Argos model cache on first use (en<->id by default).

Usage (CLI):
    python stt-engine.py translate --text "Hello world" --from en --to id
    python stt-engine.py translate --json transcript.json --from en --to id --output out.json
"""

import argparse
import json
import os
import sys
import tempfile
import time

ARGO_INDEX_URL = "https://raw.githubusercontent.com/argosopentech/argospm-index/main/index.json"

# Language pairs we support out of the box. Add more by appending to this list.
SUPPORTED_PAIRS = [
    ("en", "id"),
    ("id", "en"),
]


def _is_installed(from_code: str, to_code: str) -> bool:
    try:
        import argostranslate.translate as _t
        installed = _t.get_installed_languages()
        frm = next((l for l in installed if l.code == from_code), None)
        if frm is None:
            return False
        for tr in frm.translations_from:
            if getattr(tr.to_lang, "code", "") == to_code:
                return True
        return False
    except Exception:
        return False


def ensure_models(from_code: str, to_code: str, progress=None) -> None:
    """Download + install the Argos package for (from_code -> to_code) if missing."""
    if _is_installed(from_code, to_code):
        return

    import argostranslate.package

    if progress:
        progress(5, f"Menyiapkan model terjemahan {from_code}->{to_code}...")
    try:
        packages = argostranslate.package.get_available_packages()
    except Exception as e:
        raise RuntimeError(
            f"Gagal mengambil daftar model Argos ({e}). "
            "Cek koneksi internet — model terjemahan didownload sekali."
        )
    pkg = next((p for p in packages if p.from_code == from_code and p.to_code == to_code), None)
    if pkg is None:
        raise RuntimeError(f"Model terjemahan {from_code}->{to_code} tidak tersedia.")

    if progress:
        progress(15, f"Mendownload model {from_code}->{to_code}...")
    # download() returns the path of the .argosmodel file; install_from_path installs it.
    model_path = pkg.download()
    argostranslate.package.install_from_path(model_path)
    if progress:
        progress(60, "Model terpasang. Menyalakan mesin...")
    # Force-load the translation object once so subsequent calls are warm.
    _get_translator(from_code, to_code)
    if progress:
        progress(100, "Model terjemahan siap.")


def _get_translator(from_code: str, to_code: str):
    import argostranslate.translate as _t
    return _t.get_translation_from_codes(from_code, to_code)


def translate_text(text: str, from_code: str, to_code: str, ensure: bool = True) -> str:
    """Translate a single string. `ensure=False` skips model auto-install."""
    if not text or not str(text).strip():
        return text or ""
    if ensure:
        ensure_models(from_code, to_code)
    translator = _get_translator(from_code, to_code)
    return translator.translate(str(text))


def translate_segments(segments, from_code: str, to_code: str, ensure: bool = True):
    """
    Translate a transcript (list of {start,end,text,words[]}) preserving timing.
    Word-level timestamps of the source are dropped when the translated text
    length differs too much — the caption engine re-interpolates word timing.
    """
    if not segments:
        return segments
    # Same source & target: nothing to translate — return unchanged segments.
    if from_code == to_code:
        return [dict(seg) for seg in segments]
    if ensure:
        ensure_models(from_code, to_code)
    translator = _get_translator(from_code, to_code)

    out = []
    for seg in segments:
        text = str(seg.get("text") or "").strip()
        if not text:
            out.append(dict(seg))
            continue
        translated = translator.translate(text)
        nseg = {
            "start": seg.get("start", 0),
            "end": seg.get("end", 0),
            "text": translated,
            "words": seg.get("words", []),
        }
        # Keep extra fields (speaker, confidence, language) if present.
        for k in ("speaker", "confidence", "language"):
            if k in seg:
                nseg[k] = seg[k]
        out.append(nseg)
    return out


def _cli_text(args) -> int:
    result = translate_text(args.text, args.from_code, args.to_code)
    print(result)
    return 0


def _cli_json(args) -> int:
    with open(args.json, "r", encoding="utf-8") as f:
        data = json.load(f)
    segments = data if isinstance(data, list) else data.get("segments", [])
    translated = translate_segments(segments, args.from_code, args.to_code)
    if isinstance(data, list):
        payload = translated
    else:
        payload = dict(data)
        payload["segments"] = translated
    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
        print(f"Output: {args.output}", file=sys.stderr)
    else:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0


def _cli_install(args) -> int:
    ensure_models(args.from_code, args.to_code)
    print(f"Model {args.from_code}->{args.to_code} siap.")
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(description="Clipper Studio offline translator")
    sub = parser.add_subparsers(dest="command")

    t = sub.add_parser("translate-text", help="Translate a string")
    t.add_argument("--text", required=True)
    t.add_argument("--from", dest="from_code", required=True)
    t.add_argument("--to", dest="to_code", required=True)

    j = sub.add_parser("translate-json", help="Translate a transcript JSON")
    j.add_argument("--json", required=True)
    j.add_argument("--from", dest="from_code", required=True)
    j.add_argument("--to", dest="to_code", required=True)
    j.add_argument("--output", default="")

    i = sub.add_parser("install-models", help="Pre-download translation models")
    i.add_argument("--from", dest="from_code", required=True)
    i.add_argument("--to", dest="to_code", required=True)

    args = parser.parse_args(argv)
    if not args.command:
        parser.print_help()
        return 1
    if args.command == "translate-text":
        return _cli_text(args)
    if args.command == "translate-json":
        return _cli_json(args)
    if args.command == "install-models":
        return _cli_install(args)
    return 1


if __name__ == "__main__":
    sys.exit(main())
