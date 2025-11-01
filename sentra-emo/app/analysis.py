from typing import Dict, List, Tuple, Optional, Any
from pathlib import Path
import json
import logging

from .config import (
    get_vad_config_paths,
    PROJECT_ROOT,
    get_negative_config_paths,
    get_negative_valence_threshold,
)

logger = logging.getLogger(__name__)


_negative_labels: Optional[set[str]] = None
_last_emotion_dir: Optional[Path] = None
_vad_status: Dict[str, Any] = {
    "emotion_model_dir": None,
    "map_path": None,
    "alias_path": None,
    "unknown_labels_path": None,
    "unknown_labels_count": 0,
    "unknown_labels": [],
    "negative_path": None,
    "negative_labels_count": 0,
    "negative_labels_source": None,  # file|derived|unknown
    "negative_threshold": None,
}


class VADMapper:
    def __init__(self, mapping: Dict[str, Tuple[float, float, float]], alias: Optional[Dict[str, str]] = None) -> None:
        # canonical lower-case label -> (v,a,d)
        self.mapping: Dict[str, Tuple[float, float, float]] = {
            str(k).lower(): (float(v), float(a), float(d)) for k, (v, a, d) in mapping.items()
        }
        self.alias: Dict[str, str] = {str(k).lower(): str(v).lower() for k, v in (alias or {}).items()}

    def canonical(self, label: str) -> str:
        l = str(label).lower()
        return self.alias.get(l, l)

    def map_label(self, label: str) -> Tuple[float, float, float]:
        key = self.canonical(label)
        return self.mapping.get(key, (0.5, 0.5, 0.5))

    def map_distribution(self, distribution: List[Tuple[str, float]]) -> Tuple[float, float, float]:
        if not distribution:
            return 0.5, 0.5, 0.5
        v = a = d = 0.0
        total = 0.0
        for label, score in distribution:
            vv, aa, dd = self.map_label(label)
            v += score * vv
            a += score * aa
            d += score * dd
            total += score
        if total <= 0:
            return 0.5, 0.5, 0.5
        return v / total, a / total, d / total

    def unknown_labels(self, labels: List[str]) -> List[str]:
        res: List[str] = []
        for l in labels:
            c = self.canonical(l)
            if c not in self.mapping:
                res.append(l)
        return sorted(set(res))


_vad_mapper: Optional[VADMapper] = None


def _load_mapping_from_json(p: Path) -> Dict[str, Tuple[float, float, float]]:
    data = json.loads(p.read_text(encoding="utf-8"))
    mapping: Dict[str, Tuple[float, float, float]] = {}
    for k, v in data.items():
        if isinstance(v, dict):
            mapping[k] = (float(v.get("valence", 0.5)), float(v.get("arousal", 0.5)), float(v.get("dominance", 0.5)))
        elif isinstance(v, list) and len(v) == 3:
            mapping[k] = (float(v[0]), float(v[1]), float(v[2]))
        else:
            logger.warning(f"Invalid VAD entry for label={k} in {p}")
    return mapping


def _ensure_default_mapper() -> None:
    global _vad_mapper
    if _vad_mapper is not None:
        return
    default_path = PROJECT_ROOT / "app" / "vad_maps" / "default.json"
    if default_path.exists():
        m = _load_mapping_from_json(default_path)
        _vad_mapper = VADMapper(m, alias=None)
        logger.info(f"Loaded default VAD mapping from {default_path}")
    else:
        logger.warning("Default VAD mapping file not found; using neutral-only fallback")
        _vad_mapper = VADMapper({"neutral": (0.5, 0.3, 0.5)})


def init_vad_mapper(emotion_model_dir: Path | str, emotion_labels: Optional[List[str]] = None) -> None:
    """Initialize global VAD mapper from JSON files near the emotion model.
    Priority: model_dir/vad_map.json -> parent/vad_map.json -> app/config/vad_map.json -> app/vad_maps/default.json
    Aliases similarly with label_alias.json. Unknown labels are written to unknown_labels.json next to parent.
    """
    global _vad_mapper
    emo_dir = Path(emotion_model_dir)
    global _last_emotion_dir, _vad_status
    _last_emotion_dir = emo_dir
    paths = get_vad_config_paths(emo_dir)
    map_path = paths["map"]
    alias_path = paths["alias"]
    if map_path is None:
        logger.info("No specific VAD map found; falling back to default")
        _ensure_default_mapper()
        mapper = _vad_mapper
    else:
        mapping = _load_mapping_from_json(map_path)
        alias: Optional[Dict[str, str]] = None
        if alias_path is not None and alias_path.exists():
            try:
                alias = json.loads(alias_path.read_text(encoding="utf-8"))
            except Exception as e:  # noqa: BLE001
                logger.warning(f"Failed to read alias file {alias_path}: {e}")
        mapper = VADMapper(mapping, alias)
        _vad_mapper = mapper
        logger.info(f"Loaded VAD mapping from {map_path} (alias: {alias_path if alias_path else 'none'})")

    # Record unknown labels (always write file for discoverability)
    try:
        unknown_path: Path = paths["unknown"]  # type: ignore[assignment]
        unknowns: List[str] = []
        if emotion_labels is not None and mapper is not None:
            unknowns = mapper.unknown_labels(emotion_labels)
        unknown_path.write_text(
            json.dumps({"unknown_labels": unknowns}, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        logger.info(f"Wrote unknown emotion labels to {unknown_path} (count={len(unknowns)})")
        # update status snapshot
        _vad_status.update(
            {
                "emotion_model_dir": str(emo_dir),
                "map_path": str(map_path) if map_path else None,
                "alias_path": str(alias_path) if alias_path else None,
                "unknown_labels_path": str(unknown_path),
                "unknown_labels_count": len(unknowns),
                "unknown_labels": unknowns,
            }
        )
    except Exception as e:  # noqa: BLE001
        logger.warning(f"Failed to write unknown labels file: {e}")


def _load_negative_from_file(p: Path) -> Optional[set[str]]:
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
        labels: set[str] = set()
        if isinstance(data, list):
            labels = {str(x).lower() for x in data}
        elif isinstance(data, dict):
            # support {"labels": [..]} or {"anger": true, ...}
            if "labels" in data and isinstance(data["labels"], list):
                labels = {str(x).lower() for x in data["labels"]}
            else:
                for k, v in data.items():
                    if bool(v):
                        labels.add(str(k).lower())
        return labels
    except Exception as e:  # noqa: BLE001
        logger.warning(f"Failed to parse negative emotions file {p}: {e}")
        return None


def init_negative_labels(emotion_model_dir: Path | str, emotion_labels: Optional[List[str]] = None) -> None:
    """Initialize dynamic negative emotion labels.
    Priority: negative_emotions.json (same search strategy as VAD config) -> derive by V<threshold.
    """
    global _negative_labels, _vad_mapper
    emo_dir = Path(emotion_model_dir)
    neg_paths = get_negative_config_paths(emo_dir)
    neg_path = neg_paths["neg"]

    # 1) Try explicit file
    if neg_path is not None and neg_path.exists():
        loaded = _load_negative_from_file(neg_path)
        if loaded is not None:
            _negative_labels = loaded
            logger.info(f"Loaded negative emotions from {neg_path} (count={len(_negative_labels)})")
            _vad_status.update(
                {
                    "negative_path": str(neg_path),
                    "negative_labels_count": len(_negative_labels),
                    "negative_labels_source": "file",
                }
            )
            return

    # 2) Derive from V valence threshold using current VAD mapper
    if _vad_mapper is None:
        _ensure_default_mapper()
    threshold = get_negative_valence_threshold()
    derived: set[str] = set()
    # Choose candidate labels: provided emotion_labels else mapper's keys
    candidates = emotion_labels if emotion_labels else list(getattr(_vad_mapper, "mapping", {}).keys())  # type: ignore[attr-defined]
    for lbl in candidates:
        v, a, d = _vad_mapper.map_label(lbl)  # type: ignore[union-attr]
        if v < threshold:
            derived.add(_vad_mapper.canonical(lbl))  # type: ignore[union-attr]
    _negative_labels = derived
    logger.info(f"Derived negative emotions by V<{threshold}: count={len(_negative_labels)}")
    _vad_status.update(
        {
            "negative_path": None,
            "negative_labels_count": len(_negative_labels),
            "negative_labels_source": "derived",
            "negative_threshold": float(threshold),
        }
    )


def normalize_distribution(pairs: List[Tuple[str, float]]) -> List[Tuple[str, float]]:
    total = sum(max(0.0, s) for _, s in pairs)
    if total <= 0:
        # 均匀分布回退
        n = len(pairs) if pairs else 1
        return [(lbl, 1.0 / n) for lbl, _ in pairs]
    return [(lbl, max(0.0, s) / total) for lbl, s in pairs]


def emotions_to_vad(distribution: List[Tuple[str, float]]):
    """将情绪概率分布映射为VAD。未知标签按中性处理/默认映射处理。"""
    global _vad_mapper
    if _vad_mapper is None:
        _ensure_default_mapper()
    assert _vad_mapper is not None
    return _vad_mapper.map_distribution(distribution)


def derive_stress(valence: float, arousal: float, distribution: List[Tuple[str, float]]):
    """根据 V、A 与负向情绪占比推导压力值，返回 [0,1]。
    Stress = clip(0,1, 0.6*(1 - V) + 0.4*A + 0.15*NegEmotionSum)
    """
    # Ensure negative labels initialized
    global _negative_labels
    if _negative_labels is None:
        # Try to derive without labels list
        init_negative_labels(emotion_model_dir=PROJECT_ROOT / "models" / "emotion", emotion_labels=None)
    neg_sum = 0.0
    for label, score in distribution:
        lab = str(label)
        canon = _vad_mapper.canonical(lab) if _vad_mapper else lab.lower()
        if _negative_labels and canon in _negative_labels:
            neg_sum += score
    stress = 0.6 * (1.0 - valence) + 0.4 * arousal + 0.15 * neg_sum
    stress = max(0.0, min(1.0, stress))
    if stress < 0.33:
        level = "low"
    elif stress < 0.66:
        level = "medium"
    else:
        level = "high"
    return stress, level


def get_vad_status() -> Dict[str, Any]:
    """Return snapshot of current VAD/negative labels status.
    If not initialized yet, ensure default mapper, and return current snapshot.
    """
    global _vad_mapper, _vad_status, _last_emotion_dir
    if _vad_mapper is None:
        _ensure_default_mapper()
    # enrich unknown labels from file if exists
    try:
        upath = _vad_status.get("unknown_labels_path")
        if upath and Path(upath).exists():
            data = json.loads(Path(upath).read_text(encoding="utf-8"))
            u = data.get("unknown_labels", [])
            if isinstance(u, list):
                _vad_status["unknown_labels"] = [str(x) for x in u]
                _vad_status["unknown_labels_count"] = len(_vad_status["unknown_labels"])
    except Exception:
        pass
    # attach last emotion dir explicitly
    return dict(_vad_status)


def canonicalize_distribution(distribution: List[Tuple[str, float]]) -> List[Tuple[str, float]]:
    """Return a new distribution with labels canonicalized using alias mapping.
    If mapper is not initialized yet, load default to ensure canonical() works.
    """
    global _vad_mapper
    if _vad_mapper is None:
        _ensure_default_mapper()
    res: List[Tuple[str, float]] = []
    for lbl, score in distribution:
        try:
            canon = _vad_mapper.canonical(lbl) if _vad_mapper else str(lbl).lower()
        except Exception:
            canon = str(lbl)
        res.append((canon, float(score)))
    return res
