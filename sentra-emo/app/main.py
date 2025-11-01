import logging
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import time
from typing import List

from .schemas import AnalyzeRequest, AnalyzeResponse, LabelScore, SentimentResult, VADResult, PADResult, StressResult
from .models import ModelManager
from .analysis import emotions_to_vad, derive_stress, init_vad_mapper, get_vad_status, canonicalize_distribution
from .config import get_device_report, use_emotion_label_alias

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

models = ModelManager()

_metrics = {
    "start_time": time.perf_counter(),
    "inference_latencies_ms": [],  # type: List[float]
    "inference_count": 0,
    "error_count": 0,
    "emotion_top1_scores": [],  # type: List[float]
    "emotion_top1_times": [],  # type: List[float]
}


def _record_latency_ms(ms: float) -> None:
    _metrics["inference_count"] += 1
    buf: List[float] = _metrics["inference_latencies_ms"]
    buf.append(float(ms))
    # cap buffer size to avoid unbounded growth
    if len(buf) > 2000:
        del buf[: len(buf) - 1000]


def _percentile(values: List[float], q: float):
    if not values:
        return None
    s = sorted(values)
    n = len(s)
    idx = int(q * (n - 1))
    idx = max(0, min(idx, n - 1))
    return float(s[idx])


def _record_emotion_top1(score: float) -> None:
    _metrics["emotion_top1_scores"].append(float(score))
    _metrics["emotion_top1_times"].append(float(time.perf_counter()))
    if len(_metrics["emotion_top1_scores"]) > 2000:
        del _metrics["emotion_top1_scores"][: len(_metrics["emotion_top1_scores"]) - 1000]
        del _metrics["emotion_top1_times"][: len(_metrics["emotion_top1_times"]) - 1000]


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    try:
        emo_pipe, emo_mid = models.ensure_emotion()
        labels = []
        try:
            id2label = getattr(emo_pipe.model.config, "id2label", None)
            if isinstance(id2label, dict) and id2label:
                numeric_keys = [k for k in id2label.keys() if isinstance(k, int) or (isinstance(k, str) and str(k).isdigit())]
                if numeric_keys:
                    idxs = sorted([int(k) for k in id2label.keys()])
                    labels = [str(id2label[i]) for i in idxs]
                else:
                    labels = [str(v) for v in id2label.values()]
        except Exception:
            labels = []
        init_vad_mapper(emo_mid, labels if labels else None)
    except Exception as e:  # noqa: BLE001
        logger.warning(f"Startup VAD init skipped: {e}")

    try:
        models.ensure_sentiment()
    except Exception as e:  # noqa: BLE001
        logger.warning(f"Startup sentiment preload skipped: {e}")

    # Log device report once at startup
    try:
        dev = get_device_report()
        logger.info(
            "Device decision: using=%s index=%s name=%s cuda_available=%s count=%s (mode=%s selector=%s)",
            dev.get("using"),
            dev.get("index"),
            dev.get("device_name"),
            dev.get("cuda_available"),
            dev.get("cuda_device_count"),
            dev.get("mode"),
            dev.get("selector"),
        )
    except Exception:
        pass

    yield
    # Teardown (nothing for now)


app = FastAPI(title="Sentra Emo: 文本情绪/情感/VAD/PAD/压力分析", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/analyze", response_model=AnalyzeResponse, response_model_exclude_none=True)
async def analyze(req: AnalyzeRequest):
    text = (req.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="text 不能为空")

    t0 = time.perf_counter()
    try:
        # Local backend flow only
        # Ensure emotion model is ready and initialize VAD mapper dynamically using its labels
        emo_pipe, emo_mid = models.ensure_emotion()
        labels = []
        try:
            id2label = getattr(emo_pipe.model.config, "id2label", None)
            if isinstance(id2label, dict) and id2label:
                # Try to preserve order 0..N-1 if numeric keys
                numeric_keys = [k for k in id2label.keys() if isinstance(k, int) or (isinstance(k, str) and str(k).isdigit())]
                if numeric_keys:
                    # sort by numeric
                    idxs = sorted([int(k) for k in id2label.keys()])
                    labels = [str(id2label[i]) for i in idxs]
                else:
                    labels = [str(v) for v in id2label.values()]
        except Exception:
            labels = []
        init_vad_mapper(emo_mid, labels if labels else None)

        sentiment = models.analyze_sentiment(text)
        emotions_pairs = models.analyze_emotions(text)
        if use_emotion_label_alias():
            canon_pairs = canonicalize_distribution(emotions_pairs)
        else:
            canon_pairs = emotions_pairs
        v, a, d = emotions_to_vad(canon_pairs)
        stress, level = derive_stress(v, a, canon_pairs)

        resp = AnalyzeResponse(
            sentiment=SentimentResult(**sentiment),
            emotions=[LabelScore(label=k, score=float(v)) for k, v in canon_pairs],
            vad=VADResult(valence=float(v), arousal=float(a), dominance=float(d), method="emotion_mapping"),
            pad=PADResult(pleasure=float(v), arousal=float(a), dominance=float(d)),
            stress=StressResult(score=float(stress), level=level),
            models={
                "sentiment": sentiment.get("raw_model", "unknown"),
                "emotion": models._emotion_model_id or "unknown",
            },
        )
        dt_ms = (time.perf_counter() - t0) * 1000.0
        _record_latency_ms(dt_ms)
        try:
            sent_label = getattr(resp.sentiment, "label", None)
            vad_v = float(getattr(resp.vad, "valence", 0.0))
            vad_a = float(getattr(resp.vad, "arousal", 0.0))
            vad_d = float(getattr(resp.vad, "dominance", 0.0))
            stress_level = getattr(resp.stress, "level", None)
        except Exception:
            sent_label, stress_level, vad_v, vad_a, vad_d = None, None, 0.0, 0.0, 0.0
        try:
            if canon_pairs:
                _record_emotion_top1(float(canon_pairs[0][1]))
        except Exception:
            pass
        logger.info(
            "Analyze OK in %.1f ms | sent=%s stress=%s V=%.2f A=%.2f D=%.2f text_len=%d",
            dt_ms,
            sent_label,
            stress_level,
            vad_v,
            vad_a,
            vad_d,
            len(text),
        )
        return resp
    except Exception as e:  # noqa: BLE001
        dt_ms = (time.perf_counter() - t0) * 1000.0
        _record_latency_ms(dt_ms)
        _metrics["error_count"] += 1
        logger.exception("Analyze error in %.1f ms: %s", dt_ms, e)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/models")
async def models_status():
    """Return available models, selected models, and VAD mapping/alias sources and unknown-labels info."""
    try:
        status = models.get_status()
        status["backend"] = "local"
    except Exception as e:  # pragma: no cover
        status = {"error": str(e)}
    try:
        vad = get_vad_status()
    except Exception as e:  # pragma: no cover
        vad = {"error": str(e)}
    return {"models": status, "vad": vad}


@app.get("/metrics")
async def metrics():
    lat = _metrics["inference_latencies_ms"]
    avg = (sum(lat) / len(lat)) if lat else None
    es = _metrics["emotion_top1_scores"]
    et = _metrics["emotion_top1_times"]
    now = float(time.perf_counter())
    def _recent(vals: List[float], times: List[float], window_sec: float):
        if not vals or not times:
            return {"avg": None, "p50": None, "p95": None, "p99": None, "count": 0}
        sel = [v for v, t in zip(vals, times) if (now - t) <= window_sec]
        if not sel:
            return {"avg": None, "p50": None, "p95": None, "p99": None, "count": 0}
        a = sum(sel) / len(sel)
        return {"avg": float(a), "p50": _percentile(sel, 0.50), "p95": _percentile(sel, 0.95), "p99": _percentile(sel, 0.99), "count": len(sel)}
    return {
        "uptime_sec": (time.perf_counter() - _metrics["start_time"]),
        "inference_count": _metrics["inference_count"],
        "error_count": _metrics["error_count"],
        "inference_latency_ms": {
            "avg": float(avg) if avg is not None else None,
            "p50": _percentile(lat, 0.50),
            "p95": _percentile(lat, 0.95),
            "p99": _percentile(lat, 0.99),
        },
        "model_load_sec": models.get_status(),
        "device": get_device_report(),
        "emotion_top1_score": {
            "avg": (sum(es) / len(es)) if es else None,
            "p50": _percentile(es, 0.50),
            "p95": _percentile(es, 0.95),
            "p99": _percentile(es, 0.99),
            "count": len(es),
        },
        "emotion_top1_score_recent": {
            "60s": _recent(es, et, 60.0),
            "300s": _recent(es, et, 300.0),
        },
    }
