# 情绪/情感/PAD(VAD)/压力分析服务（FastAPI）

本项目提供一个基于真实神经网络模型（Hugging Face Transformers）的文本分析服务：
- 情感极性（正/中/负）
- 多类别情绪分布（如 joy/anger/fear/sadness/...）
- VAD/PAD（Valence/Arousal/Dominance 与 Pleasure/Arousal/Dominance）
- 压力分值（依据 V 与 A 等派生的可解释公式，范围 0~1）

注意：VAD/PAD 当前通过“情绪分布 → 连续维度”的业界常用映射法估计；后续可无缝接入直接回归VAD的模型。

## 依赖安装

- Python 3.10+
- Windows 下建议使用 venv

```powershell
python -m venv .venv
. .venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

本服务离线运行：仅从本项目的 `models/` 目录加载模型文件，无需联网与环境变量。

## 运行

```powershell
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

浏览器打开 http://localhost:8000/docs 查看交互式接口。

## 本地模型目录与选择规则（无需联网）

将 Hugging Face 模型文件（`config.json`、`tokenizer.*`、`pytorch_model.bin` 或 `model.safetensors` 等）放入如下目录：

```
models/
  sentiment/                 # 情感模型（正/负/中 等）
    # 方式A：直接放模型文件在此目录（包含 config.json 等）
    # 方式B：按子目录放置多个模型：
    erlangshen/              # 示例子目录1（含完整模型文件）
    jd_binary/               # 示例子目录2
    priority.txt             # 可选：首行写入首选子目录名（如：erlangshen）

  emotion/                   # 情绪模型（joy/anger/... 分布）
    xlm_emo/                 # 示例子目录1
    other_emotion_model/     # 示例子目录2
    priority.txt             # 可选：首行写入首选子目录名
```

选择规则：
- 若 `models/<kind>/` 目录本身包含 `config.json`（方式A），直接加载该目录。
- 否则扫描子目录（方式B）：
  - 如果存在 `priority.txt`，其首行对应的子目录将被优先使用；
  - 否则按子目录名的字母序选择第一个。

注意：服务端严格以本地文件加载（`local_files_only=True`），若目录不存在或不完整会直接报错，不会尝试网络下载。

## API

- POST `/analyze`

请求体：
```json
{
  "text": "这次发布延期太久了，我压力很大，还挺生气的。"
}
```

响应示例（字段可能因模型不同略有差异）：
```json
{
  "sentiment": {
    "label": "negative",
    "scores": {"negative": 0.82, "neutral": 0.10, "positive": 0.08},
    "raw_model": "IDEA-CCNL/Erlangshen-Roberta-110M-Sentiment"
  },
  "emotions": [
    {"label": "anger", "score": 0.55},
    {"label": "sadness", "score": 0.18},
    {"label": "fear", "score": 0.10},
    {"label": "joy", "score": 0.05},
    {"label": "neutral", "score": 0.12}
  ],
  "vad": {"valence": 0.27, "arousal": 0.76, "dominance": 0.49, "method": "emotion_mapping"},
  "pad": {"pleasure": 0.27, "arousal": 0.76, "dominance": 0.49},
  "stress": {"score": 0.73, "level": "high"},
  "models": {
    "sentiment": "IDEA-CCNL/Erlangshen-Roberta-110M-Sentiment",
    "emotion": "MilaNLProc/xlm-emo-t"
  }
}
```

## 模型与最佳实践

- **仅本地模型**：请将你需要的模型完整文件夹放入 `models/sentiment/` 与 `models/emotion/`。
- **多模型管理**：可放多个子目录，通过 `priority.txt` 控制优先级，或按字母序默认选择。
- **VAD/PAD**：
  - 默认采用“情绪分布 → VAD/PAD”的经验映射；
  - 如需更贴合业务，可在 `app/analysis.py` 中调整 `VAD_MAP` 或替换为你本地的 VAD 回归模型（可另建 `models/vad/` 并在代码中接入）。
- **压力分值**：
  - 目前以 `Stress = clip(0,1, 0.6*(1 - V) + 0.4*A + 0.15*NegEmotionSum)` 计算，可解释、可调参。

## 常见问题

- **启动报错：未发现本地模型**：请检查是否已按上面的目录结构放置模型文件；至少各放置一个情感模型与一个情绪模型。
- **输出解释**：响应中的 `models` 字段会返回实际使用的本地模型路径。不同模型标签集可能不同，情感部分会标准化为 `negative/neutral/positive` 三类，情绪部分为模型原始标签。
- **CPU/GPU**：默认 CPU 可运行，GPU 会更快。

## 目录结构

```
app/
  main.py          # FastAPI 入口
  models.py        # 模型加载与推理封装（Transformers）
  analysis.py      # 情绪→VAD/PAD映射，压力分值计算
  schemas.py       # Pydantic 请求/响应模型
requirements.txt
README.md
```
