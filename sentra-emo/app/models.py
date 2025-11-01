import logging
from typing import Dict, List, Tuple, Optional, Any
import os
from pathlib import Path
import time

from transformers import (
    AutoTokenizer,
    AutoModelForSequenceClassification,
    TextClassificationPipeline,
    pipeline,
)
from .config import (
    get_pipeline_device_index,
    get_model_selector,
    is_emotion_multi_label,
    get_emotion_threshold,
    get_emotion_topk,
    get_sentiment_neutral_mode,
)

logger = logging.getLogger(__name__)


class ModelManager:
    def __init__(self) -> None:
        self._sentiment_pipe: Optional[TextClassificationPipeline] = None
        self._sentiment_model_id: Optional[str] = None
        self._emotion_pipe: Optional[TextClassificationPipeline] = None
        self._emotion_model_id: Optional[str] = None
        # discovery and telemetry
        self._sentiment_candidates: List[str] = []
        self._emotion_candidates: List[str] = []
        self._sentiment_load_sec: Optional[float] = None
        self._emotion_load_sec: Optional[float] = None
    
    def _build_local_candidates(self, kind: str) -> List[str]:
        """Discover local model directories under ./models/<kind>.
        Rules:
        - If ./models/<kind>/ has config.json directly, use that directory as a candidate.
        - Else, enumerate subdirectories containing either config.json or model weights (pytorch_model.bin/model.safetensors).
        - Optional: ./models/<kind>/priority.txt with one line (subdir name) will be put first if exists.
        """
        candidates: List[str] = []
        project_root = Path(__file__).resolve().parents[1]
        base = project_root / "models" / kind
        if not base.exists():
            logger.warning(f"Local models directory not found: {base}")
            return candidates

        def is_model_dir(d: Path) -> bool:
            return (d / "config.json").exists() or (d / "pytorch_model.bin").exists() or (d / "model.safetensors").exists()

        # Env selector overrides
        try:
            selector = get_model_selector(kind)
        except Exception:
            selector = None
        if selector:
            # absolute path or subdir under base
            sp = Path(selector)
            if not sp.is_absolute():
                sp = base / selector
            if is_model_dir(sp):
                return [str(sp)]
            else:
                logger.warning(f"Env selector for {kind} not found or invalid: {sp}")

        # Case 1: direct model files inside base
        if is_model_dir(base):
            candidates.append(str(base))
            return candidates

        # Optional priority
        priority_path = base / "priority.txt"
        priority: Optional[str] = None
        if priority_path.exists():
            try:
                priority = priority_path.read_text(encoding="utf-8").strip().splitlines()[0].strip()
            except Exception:  # noqa: BLE001
                priority = None

        # Case 2: subdirectories
        subs = [d for d in base.iterdir() if d.is_dir() and is_model_dir(d)]
        subs_sorted = sorted(subs, key=lambda p: p.name.lower())
        if priority:
            subs_sorted = sorted(subs_sorted, key=lambda p: (0 if p.name == priority else 1, p.name.lower()))
        candidates = [str(p) for p in subs_sorted]
        if not candidates:
            logger.warning(f"No local models discovered under: {base}")
        else:
            logger.info(f"Discovered local {kind} models: {candidates}")
        return candidates

    def _load_first_available(self, model_ids: List[str], task: str, *, multilabel: bool = False) -> Tuple[TextClassificationPipeline, str, float]:
        last_err: Optional[Exception] = None
        for mid in model_ids:
            try:
                t0 = time.perf_counter()
                tok = AutoTokenizer.from_pretrained(mid, local_files_only=True)
                mdl = AutoModelForSequenceClassification.from_pretrained(mid, local_files_only=True)
                device = get_pipeline_device_index()
                f2a = "sigmoid" if multilabel else None
                pipe = pipeline(task=task, model=mdl, tokenizer=tok, device=device, function_to_apply=f2a)
                dt = time.perf_counter() - t0
                logger.info(f"Loaded model: {mid} for task={task} in {dt*1000:.1f} ms (device_index={device})")
                return pipe, mid, dt
            except Exception as e:  # noqa: BLE001
                last_err = e
                logger.warning(f"Failed to load {mid} for {task}: {e}")
        raise RuntimeError(f"No available model for task={task}. Last error: {last_err}")

    def ensure_sentiment(self):
        if self._sentiment_pipe is None:
            local = self._build_local_candidates("sentiment")
            self._sentiment_candidates = local
            if not local:
                base = Path(__file__).resolve().parents[1] / "models" / "sentiment"
                raise RuntimeError(f"No local sentiment model found. Please place a HF model folder under: {base}")
            pipe, mid, dt = self._load_first_available(local, task="text-classification")
            self._sentiment_pipe, self._sentiment_model_id = pipe, mid
            self._sentiment_load_sec = dt
        return self._sentiment_pipe, self._sentiment_model_id

    def ensure_emotion(self):
        if self._emotion_pipe is None:
            local = self._build_local_candidates("emotion")
            self._emotion_candidates = local
            if not local:
                base = Path(__file__).resolve().parents[1] / "models" / "emotion"
                raise RuntimeError(f"No local emotion model found. Please place a HF model folder under: {base}")
            pipe, mid, dt = self._load_first_available(local, task="text-classification", multilabel=is_emotion_multi_label())
            self._emotion_pipe, self._emotion_model_id = pipe, mid
            self._emotion_load_sec = dt
        return self._emotion_pipe, self._emotion_model_id

    @staticmethod
    def _normalize_scores(items, *, normalize: bool = True) -> List[Tuple[str, float]]:
        """支持 return_all_scores 或 top_k=None 风格输出，统一为 (label, score) 列表。"""
        # items 可能是 [{'label':..., 'score':...}, ...] 或 [[{...}, {...}, ...]]
        if isinstance(items, list) and items and isinstance(items[0], list):
            items = items[0]
        pairs: List[Tuple[str, float]] = []
        for it in items:
            label = str(it.get("label", "")).strip()
            score = float(it.get("score", 0.0))
            pairs.append((label, score))
        # 归一化（多标签模式通常不归一化，保持独立概率）
        if normalize:
            total = sum(max(0.0, s) for _, s in pairs)
            if total > 0:
                pairs = [(l, max(0.0, s) / total) for l, s in pairs]
        return pairs

    def analyze_sentiment(self, text: str) -> Dict:
        pipe, mid = self.ensure_sentiment()
        # 取全分布
        try:
            raw = pipe(text, top_k=None)
        except Exception:  # transformers 旧版兼容
            raw = pipe(text, return_all_scores=True)
        pairs = self._normalize_scores(raw)
        neutral_mode = get_sentiment_neutral_mode()  # auto|on|off

        # 特殊模型标签处理
        scores: Dict[str, float] = {}

        # 1) nlptown 5星 -> 三类
        if mid.startswith("nlptown/bert-base-multilingual-uncased-sentiment"):
            star_scores: Dict[int, float] = {}
            for lbl, s in pairs:
                # label like "1 star" or "5 stars"
                parts = lbl.split()
                try:
                    star = int(parts[0])
                except Exception:
                    continue
                star_scores[star] = s
            neg = star_scores.get(1, 0.0) + star_scores.get(2, 0.0)
            neu = star_scores.get(3, 0.0)
            pos = star_scores.get(4, 0.0) + star_scores.get(5, 0.0)
            total = max(1e-9, neg + neu + pos)
            scores = {"negative": neg / total, "neutral": neu / total, "positive": pos / total}
            # 根据 neutral 策略裁剪
            if neutral_mode == "off":
                pos_neg = scores.get("positive", 0.0) + scores.get("negative", 0.0)
                if pos_neg <= 0:
                    # 无法区分时默认偏正向
                    scores = {"positive": 1.0, "negative": 0.0}
                else:
                    scores = {
                        "positive": scores.get("positive", 0.0) / pos_neg,
                        "negative": scores.get("negative", 0.0) / pos_neg,
                    }
        else:
            # 通用：将标签名包含正/负/中性的进行标准化
            tmp: Dict[str, float] = {}
            # 判断模型是否天然包含 neutral 类
            model_has_neutral = False
            try:
                id2label = getattr(pipe.model.config, "id2label", {})
                if isinstance(id2label, dict):
                    for v in id2label.values():
                        lv = str(v).lower()
                        if ("neu" in lv) or ("neutral" in lv):
                            model_has_neutral = True
                            break
            except Exception:
                pass
            unknown_sum = 0.0
            for lbl, s in pairs:
                l = lbl.lower()
                if "pos" in l or "positive" in l:
                    tmp["positive"] = tmp.get("positive", 0.0) + s
                elif "neg" in l or "negative" in l:
                    tmp["negative"] = tmp.get("negative", 0.0) + s
                elif "neu" in l or "neutral" in l:
                    tmp["neutral"] = tmp.get("neutral", 0.0) + s
                else:
                    # 未知标签：先累计，稍后仅在确有 neutral 且允许时并入 neutral
                    unknown_sum += s
            # 若模型确实包含 neutral 且策略允许，将未知并入 neutral
            if (model_has_neutral and neutral_mode != "off") and unknown_sum > 0:
                tmp["neutral"] = tmp.get("neutral", 0.0) + unknown_sum
            # 归一
            total = sum(tmp.values()) or 1.0
            scores = {k: v / total for k, v in tmp.items()}
            # 根据策略裁剪 neutral
            if neutral_mode == "off" or (neutral_mode == "auto" and not model_has_neutral):
                # 删除 neutral 并重归一
                pos = scores.get("positive", 0.0)
                neg = scores.get("negative", 0.0)
                denom = pos + neg
                if denom <= 0:
                    # 若两者皆0，则回退：pos=1, neg=0
                    scores = {"positive": 1.0, "negative": 0.0}
                else:
                    scores = {"positive": pos / denom, "negative": neg / denom}
            else:
                # 保证三类键存在再归一
                for k in ("negative", "neutral", "positive"):
                    scores.setdefault(k, 0.0)
                total = sum(scores.values()) or 1.0
                scores = {k: v / total for k, v in scores.items()}

        # 取最大为标签
        label = max(scores.items(), key=lambda x: x[1])[0]
        return {
            "label": label,
            "scores": scores,
            "raw_model": mid,
        }

    def analyze_emotions(self, text: str) -> List[Tuple[str, float]]:
        pipe, _ = self.ensure_emotion()
        try:
            raw = pipe(text, top_k=None)
        except Exception:
            raw = pipe(text, return_all_scores=True)
        multi = is_emotion_multi_label()
        pairs = self._normalize_scores(raw, normalize=(not multi))
        # 多标签：基于阈值与TopK选择；若为空，回退Top-1
        if multi:
            thr = get_emotion_threshold()
            topk = get_emotion_topk()
            selected = [(l, s) for (l, s) in pairs if s >= thr]
            selected.sort(key=lambda x: x[1], reverse=True)
            if topk and len(selected) > topk:
                selected = selected[:topk]
            if not selected and pairs:
                selected = [max(pairs, key=lambda x: x[1])]
            return selected
        # 单标签：返回降序分布，并支持 TopK 可见裁剪（若配置）
        sorted_pairs = sorted(pairs, key=lambda x: x[1], reverse=True)
        topk = get_emotion_topk()
        if topk and len(sorted_pairs) > topk:
            return sorted_pairs[:topk]
        return sorted_pairs

    def get_status(self) -> Dict[str, Any]:
        """Return discovery and loading status for models."""
        return {
            "sentiment": {
                "selected": self._sentiment_model_id,
                "candidates": list(self._sentiment_candidates),
                "loaded": bool(self._sentiment_pipe is not None),
                "load_time_sec": float(self._sentiment_load_sec) if self._sentiment_load_sec is not None else None,
            },
            "emotion": {
                "selected": self._emotion_model_id,
                "candidates": list(self._emotion_candidates),
                "loaded": bool(self._emotion_pipe is not None),
                "load_time_sec": float(self._emotion_load_sec) if self._emotion_load_sec is not None else None,
            },
        }
