import os
from pathlib import Path
from typing import Any
from dotenv import load_dotenv

# Load .env from project root if present
PROJECT_ROOT = Path(__file__).resolve().parents[1]
load_dotenv(dotenv_path=PROJECT_ROOT / ".env")


def get_host_port() -> tuple[str, int]:
    host = os.getenv("APP_HOST", "0.0.0.0")
    port = int(os.getenv("APP_PORT", "8000"))
    return host, port


def get_pipeline_device_index() -> int:
    """Return device index for transformers.pipeline: -1 for CPU, 0.. for CUDA index.
    Primary config:
      - SENTRA_DEVICE: auto|cpu|cuda (default: auto)
      - SENTRA_CUDA_SELECTOR (optional, preferred over SENTRA_CUDA_INDEX):
          * index=N       -> use specific CUDA index
          * name=SUBSTR   -> pick first GPU whose name contains SUBSTR (case-insensitive)
          * first         -> pick CUDA 0
          * last          -> pick last visible CUDA index
          * max_mem       -> pick GPU with max free memory
      - SENTRA_CUDA_INDEX (fallback, default 0)
    """
    mode = os.getenv("SENTRA_DEVICE", "auto").lower()
    selector = os.getenv("SENTRA_CUDA_SELECTOR", "").strip()
    index_fallback = int(os.getenv("SENTRA_CUDA_INDEX", "0"))
    try:
        import torch  # type: ignore
    except Exception:
        return -1

    def _choose_index_by_selector(sel: str) -> int:
        if not sel:
            return -2  # sentinel: not specified
        sel_l = sel.lower()
        try:
            if sel_l.startswith("index="):
                return int(sel.split("=", 1)[1].strip())
            if sel_l.startswith("name="):
                pat = sel.split("=", 1)[1].strip().lower()
                if torch.cuda.is_available():
                    for i in range(torch.cuda.device_count()):
                        try:
                            name = torch.cuda.get_device_name(i).lower()
                            if pat in name:
                                return i
                        except Exception:
                            continue
                return -1
            if sel_l == "first":
                return 0
            if sel_l == "last":
                if torch.cuda.is_available():
                    cnt = torch.cuda.device_count()
                    return cnt - 1 if cnt > 0 else -1
                return -1
            if sel_l == "max_mem":
                if torch.cuda.is_available():
                    best_i, best_free = -1, -1
                    for i in range(torch.cuda.device_count()):
                        try:
                            with torch.cuda.device(i):
                                free, total = torch.cuda.mem_get_info()  # type: ignore[attr-defined]
                            if free > best_free:
                                best_i, best_free = i, int(free)
                        except Exception:
                            continue
                    return best_i
                return -1
        except Exception:
            return -1
        return -1

    if mode == "cpu":
        return -1
    if not torch.cuda.is_available():
        return -1

    # mode in {"cuda", "auto"}
    idx = _choose_index_by_selector(selector)
    if idx == -2:  # not specified
        # fallback to explicit index then default policy
        if mode == "cuda":
            return index_fallback
        # auto mode: choose 0
        return 0
    # selector specified; validate range
    if idx is None or idx < 0 or idx >= torch.cuda.device_count():
        # invalid selector -> fallback strategy
        return index_fallback if mode == "cuda" else 0
    return idx


def get_vad_config_paths(emotion_model_dir: Path) -> dict[str, Path | None]:
    """Return candidate paths for VAD mapping and alias JSON files.
    Priority (first existing wins):
    - emotion_model_dir / vad_map.json
    - emotion_model_dir.parent / vad_map.json
    - PROJECT_ROOT / 'app/config/vad_map.json'
    - PROJECT_ROOT / 'app/vad_maps/default.json'

    Aliases similarly with 'label_alias.json'.
    Unknown labels file path is emotion_model_dir.parent / 'unknown_labels.json'.
    """
    candidates_map = [
        emotion_model_dir / "vad_map.json",
        emotion_model_dir.parent / "vad_map.json",
        PROJECT_ROOT / "app" / "config" / "vad_map.json",
        PROJECT_ROOT / "app" / "vad_maps" / "default.json",
    ]
    candidates_alias = [
        emotion_model_dir / "label_alias.json",
        emotion_model_dir.parent / "label_alias.json",
        PROJECT_ROOT / "app" / "config" / "label_alias.json",
    ]
    chosen_map = next((p for p in candidates_map if p.exists()), None)
    chosen_alias = next((p for p in candidates_alias if p.exists()), None)
    unknown_out = emotion_model_dir.parent / "unknown_labels.json"
    return {"map": chosen_map, "alias": chosen_alias, "unknown": unknown_out}


def get_negative_config_paths(emotion_model_dir: Path) -> dict[str, Path | None]:
    """Return candidate paths for negative emotions JSON list.
    Priority (first existing wins):
    - emotion_model_dir / negative_emotions.json
    - emotion_model_dir.parent / negative_emotions.json
    - PROJECT_ROOT / 'app/config/negative_emotions.json'
    - PROJECT_ROOT / 'app/vad_maps/negative_emotions.json'
    """
    candidates_neg = [
        emotion_model_dir / "negative_emotions.json",
        emotion_model_dir.parent / "negative_emotions.json",
        PROJECT_ROOT / "app" / "config" / "negative_emotions.json",
        PROJECT_ROOT / "app" / "vad_maps" / "negative_emotions.json",
    ]
    chosen_neg = next((p for p in candidates_neg if p.exists()), None)
    return {"neg": chosen_neg}


def get_negative_valence_threshold() -> float:
    """Valence threshold used when no negative_emotions.json is provided.
    If a label's V value < threshold, it is considered negative for stress aggregation.
    Config via NEG_VALENCE_THRESHOLD (default 0.4).
    """
    try:
        return float(os.getenv("NEG_VALENCE_THRESHOLD", "0.4"))
    except Exception:
        return 0.4


def get_device_report() -> dict[str, Any]:
    """Return a small report about current device decision for observability."""
    mode = os.getenv("SENTRA_DEVICE", "auto").lower()
    selector = os.getenv("SENTRA_CUDA_SELECTOR", "").strip()
    index_cfg = os.getenv("SENTRA_CUDA_INDEX", "0")
    try:
        import torch  # type: ignore
        cuda_avail = bool(torch.cuda.is_available())
        device_count = int(torch.cuda.device_count()) if cuda_avail else 0
    except Exception:
        cuda_avail = False
        device_count = 0

    idx = get_pipeline_device_index()
    using = "cpu" if idx < 0 else "cuda"
    name = None
    if using == "cuda":
        try:
            import torch  # type: ignore
            name = torch.cuda.get_device_name(idx)
        except Exception:
            name = None

    return {
        "mode": mode,
        "selector": selector or None,
        "index_cfg": index_cfg,
        "using": using,
        "index": idx,
        "device_name": name,
        "cuda_available": cuda_avail,
        "cuda_device_count": device_count,
    }


# ----- Model selection and emotion multi-label config -----
def get_model_selector(kind: str) -> str | None:
    """Return preferred model selector from env.
    For kind='emotion': use SENTRA_EMOTION_MODEL
        - If absolute path: use that directory directly
        - Else: treat as subdirectory name under models/emotion
    For kind='sentiment': use SENTRA_SENTIMENT_MODEL (same semantics)
    """
    key = None
    if kind.lower() == "emotion":
        key = "SENTRA_EMOTION_MODEL"
    elif kind.lower() == "sentiment":
        key = "SENTRA_SENTIMENT_MODEL"
    if not key:
        return None
    val = os.getenv(key, "").strip()
    return val or None


def is_emotion_multi_label() -> bool:
    """Whether to treat emotion task as multi-label (sigmoid) at inference.
    Default: true.
    """
    v = os.getenv("EMO_MULTI_LABEL", "false").strip().lower()
    return v in {"1", "true", "yes", "on"}


def get_emotion_threshold() -> float:
    """Score threshold for selecting emotion labels in multi-label mode.
    Default: 0.25
    """
    try:
        return float(os.getenv("EMO_THRESHOLD", "0.25"))
    except Exception:
        return 0.25


def get_emotion_topk() -> int:
    """Top-K cap for visible emotion labels (0 means no cap). Default: 0."""
    try:
        return int(os.getenv("EMO_TOPK", "0"))
    except Exception:
        return 0


def get_sentiment_neutral_mode() -> str:
    """Return mode for including neutral in sentiment scores: auto|on|off.
    Default: auto
    """
    v = os.getenv("SENTRA_SENTIMENT_NEUTRAL", "auto").strip().lower()
    if v in {"on", "off", "auto"}:
        return v
    return "auto"

def use_emotion_label_alias() -> bool:
    """Whether to use label alias mapping for emotion labels.
    Default: true (use alias mapping from label_alias.json)
    """
    v = os.getenv("EMO_USE_ALIAS", "true").strip().lower()
    return v in {"1", "true", "yes", "on"}


def get_emotion_labels_file() -> Path:
    v = os.getenv("EMOTION_LABELS_FILE", "").strip()
    if v:
        p = Path(v)
        if not p.is_absolute():
            p = PROJECT_ROOT / v
        return p
    return PROJECT_ROOT / "app" / "vad_maps" / "default.json"
