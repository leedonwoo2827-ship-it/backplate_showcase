# -*- coding: utf-8 -*-
"""덱 → HyperFrames 컴포지션 폴더.

    <dist>/_hyper/
      index.html            컴포지션 한 장
      vendor/gsap.min.js    자체 호스팅 — 렌더 중 네트워크 fetch 금지(결정론)
      assets/fonts/*.woff2  한글 폰트. 시스템 폰트에 기대지 않는다
      img/002.png …         배경판
      audio/002.wav …       내레이션

★ **왜 HyperFrames 인가.** 예전 길은 거꾸로였다 — 글자를 그림에 구워 놓고,
  스틸을 찍어 이어붙인 뒤, 그 픽셀에서 글자 상자를 **되찾아** 움직였다.
  상자를 되찾는 일이 안 됐다(줄 단위 9개를 사람이 5개로 합쳤다).
  11판은 글자가 DOM 이므로 **움직일 대상이 이미 있다.** GSAP 이 그 요소를
  직접 움직이고, HyperFrames 가 결정론적으로 굽는다. 상자도 지정기도 없다.

★ **시간을 여기서 다 계산한다.** 템플릿은 계산하지 않는다. 두 곳에서 계산하면
  언젠가 서로 달라지고, 그때 화면과 소리가 갈린다.

★ `data-start` 는 **숫자**여야 한다. id 참조를 쓰면 HyperFrames 의 static-frame
  중복 제거가 꺼져 렌더가 2.1배 느려진다(260831 실측: 51.9s vs 24.7s).

★ 오디오는 **HyperFrames 가 먹는다.** `<audio data-audio-group="voiceover">` 를
  놓으면 알아서 믹스한다 — ffmpeg 로 토막을 이어붙일 일이 없다.
"""
from __future__ import annotations

import json
import shutil
from html import escape as esc
from pathlib import Path
from typing import Any, Dict, List

APP = Path(__file__).resolve().parent.parent
FONT_DIR = APP / "static" / "fonts"
GSAP = APP / "static" / "vendor" / "gsap.min.js"

W, H, FPS = 1920, 1080, 30

# 장 사이의 숨. 소리가 끝나자마자 다음 장으로 넘어가면 숨이 찬다.
TAIL_SEC = 0.45
# 라벨 하나가 떠오르는 데 걸리는 시간과 올라오는 거리
LBL_DUR, LBL_RISE = 0.55, 26.0
# 제목은 장이 시작하자마자
TITLE_DUR, TITLE_RISE = 0.5, 18.0

CSS = """
*{box-sizing:border-box;margin:0;padding:0}
body{width:%(W)dpx;height:%(H)dpx;background:#F6F1E8;overflow:hidden;
  font-family:"Pretendard","Malgun Gothic",sans-serif;
  -webkit-font-smoothing:antialiased}
.clip{position:absolute;inset:0;width:%(W)dpx;height:%(H)dpx;background:#F6F1E8}
.clip>img{position:absolute;inset:0;width:100%%;height:100%%;object-fit:fill;display:block}
/* 제목 — 그림이 비워 둔 위 10%% 띠에 앉는다. 그림 안에는 제목이 없다. */
h2{position:absolute;left:3.2%%;top:2.1%%;font-size:58px;font-weight:800;
  letter-spacing:-.035em;color:#9a4d33;line-height:1.2}
/* 라벨 — 좌표는 %%다. 편집 화면(labels.js)과 **같은 규칙**이어야 한다.
   크기도 같다: 소제목 4%% of 1080 = 43px, 설명은 그 65%% = 28px. */
.lbl{position:absolute;left:var(--lx);top:var(--ly);width:var(--lw);
  word-break:keep-all}
.lbl>b{display:block;font-weight:700;font-size:43px;line-height:1.25;
  letter-spacing:-.02em;color:#1F4E79}
.lbl>span{display:block;margin-top:.35em;font-weight:500;font-size:28px;
  line-height:1.42;letter-spacing:-.01em;color:#334155}
/* 배경이 라벨 자리로 번진 장이 있다. 상자·카드는 쓰지 않고 후광만 옅게. */
.lbl>b,.lbl>span{text-shadow:0 0 8px #F6F1E8,0 0 16px #F6F1E8}
""" % {"W": W, "H": H}

HEAD = """<!doctype html>
<html lang="ko"><head><meta charset="UTF-8">
<meta name="viewport" content="width=%(W)d, height=%(H)d">
<title>%(title)s</title>
<script src="./vendor/gsap.min.js"></script>
<style>
@font-face{font-family:"Pretendard";src:url("./assets/fonts/Pretendard-Regular.woff2") format("woff2");font-weight:400;font-display:block}
@font-face{font-family:"Pretendard";src:url("./assets/fonts/Pretendard-SemiBold.woff2") format("woff2");font-weight:600;font-display:block}
@font-face{font-family:"Pretendard";src:url("./assets/fonts/Pretendard-Bold.woff2") format("woff2");font-weight:700;font-display:block}
/* OS 폴백 — 내려받을 파일이 없으므로 선언만 한다. 선언이 없으면
   lint 의 font_family_without_font_face 로 막힌다. */
@font-face{font-family:"Malgun Gothic";src:local("Malgun Gothic")}
%(css)s</style></head><body>
"""


def _sec(v: Any, dflt: float = 0.0) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return dflt


def plan(deck: Dict[str, Any]) -> List[Dict[str, Any]]:
    """장마다 시작·길이·라벨 시각을 정한다. **시간 계산은 여기 한 곳뿐이다.**

    길이는 그 장 오디오 길이 + 숨. 오디오가 없으면 라벨 수로 가늠한다
    (라벨 하나에 10초 — s3a 의 SEC_PER_LABEL 과 같은 어림이다).
    """
    out: List[Dict[str, Any]] = []
    t = 0.0
    for s in deck.get("slides") or []:
        if s.get("drop"):
            continue
        au = _sec((s.get("audio") or {}).get("sec"))
        lbs = [l for l in (s.get("labels") or []) if (l.get("head") or "").strip()]
        dur = au + TAIL_SEC if au > 0 else max(4.0, 10.0 * max(1, len(lbs)))
        out.append({
            "no": int(s.get("no") or 0),
            "title": s.get("title") or "",
            "image": s.get("image") or "",
            "audio": (s.get("audio") or {}).get("file") or "",
            "audio_sec": au,
            "start": round(t, 3),
            "dur": round(dur, 3),
            # 라벨 시각은 **장 시작 기준**이다. 절대 시각은 타임라인에서 더한다.
            "labels": [{
                "head": l.get("head") or "",
                "sub": l.get("sub") or "",
                "x": _sec(l.get("x"), 4.0),
                "y": _sec(l.get("y"), 14.0),
                "w": _sec(l.get("w"), 23.0),
                # at 이 없으면 순서대로 벌려 놓는다 — 다 같이 뜨는 것보다 낫다
                "at": _sec(l.get("at"), i * 1.2),
            } for i, l in enumerate(lbs)],
        })
        t += dur
    return out


def _body(scenes: List[Dict[str, Any]], total: float) -> str:
    p: List[str] = []
    p.append(f'<div id="root" data-composition-id="main" data-start="0" '
             f'data-width="{W}" data-height="{H}" data-duration="{total:.3f}" '
             f'data-fps="{FPS}">')
    for sc in scenes:
        sid = f"sc{sc['no']:03d}"
        p.append(f'<section id="{sid}" class="clip" data-start="{sc["start"]:.3f}" '
                 f'data-duration="{sc["dur"]:.3f}">')
        if sc["image"]:
            p.append(f'<img src="./img/{sc["no"]:03d}.png" alt="">')
        if sc["title"]:
            p.append(f'<h2 class="ttl">{esc(sc["title"])}</h2>')
        for i, l in enumerate(sc["labels"]):
            sub = f'<span>{esc(l["sub"])}</span>' if l["sub"].strip() else ""
            p.append(f'<div class="lbl" data-i="{i}" '
                     f'style="--lx:{l["x"]}%;--ly:{l["y"]}%;--lw:{l["w"]}%">'
                     f'<b>{esc(l["head"])}</b>{sub}</div>')
        p.append("</section>")

    # ★ 내레이션. id 가 없으면 lint media_missing_id 이고 **오디오가 조용히 빠진다.**
    #   data-duration 은 **오디오 자체 길이**다(장 길이가 아니다) — 숨 구간까지
    #   오디오 슬롯으로 잡으면 나중에 더킹 구간 계산이 어긋난다.
    for sc in scenes:
        if sc["audio"] and sc["audio_sec"] > 0:
            p.append(f'<audio id="vo{sc["no"]:03d}" src="./audio/{sc["no"]:03d}.wav" '
                     f'data-audio-group="voiceover" data-start="{sc["start"]:.3f}" '
                     f'data-duration="{sc["audio_sec"]:.3f}" data-volume="1"></audio>')
    p.append("</div>")
    return "\n".join(p)


def _timeline(scenes: List[Dict[str, Any]]) -> str:
    """GSAP 타임라인. **라벨마다 제 시각에** 뜬다 — 고정 간격이 아니다.

    ★ 이것이 예전 모션과 갈리는 자리다. 예전에는 상자에 시각이 비어 있으면
      0.4초 간격으로 위에서 아래로 몰아 띄웠다 — "40초짜리 장의 글이 앞
      2.4초에 다 뜬다". 지금은 LLM 이 정한 `label_says`(몇 번째 문장에서
      말하는가)가 실측 큐 시각으로 바뀌어 여기 들어온다.
    """
    L = ["const tl = gsap.timeline({ paused: true });"]
    for sc in scenes:
        sid = f"sc{sc['no']:03d}"
        L.append(f'tl.from("#{sid} .ttl", {{ y: {TITLE_RISE}, autoAlpha: 0, '
                 f'duration: {TITLE_DUR}, ease: "power3.out" }}, {sc["start"]:.3f});')
        for i, l in enumerate(sc["labels"]):
            # 장 안 시각 → 절대 시각. 장 끝을 넘지 않게 눌러 둔다
            at = min(_sec(l["at"]), max(0.0, sc["dur"] - LBL_DUR))
            L.append(f'tl.from("#{sid} .lbl[data-i=\'{i}\']", {{ y: {LBL_RISE}, '
                     f'autoAlpha: 0, duration: {LBL_DUR}, ease: "power3.out" }}, '
                     f'{sc["start"] + at:.3f});')
    L.append('window.__timelines["main"] = tl;')
    return "\n".join(L)


def build(deck: Dict[str, Any], *, proj_dir: Path, out_dir: Path,
          title: str = "") -> Dict[str, Any]:
    """컴포지션 폴더를 만든다. 돌려주는 값은 사람이 읽을 요약."""
    scenes = plan(deck)
    total = round(sum(s["dur"] for s in scenes), 3)

    out_dir.mkdir(parents=True, exist_ok=True)
    for sub in ("img", "audio", "vendor", "assets/fonts"):
        (out_dir / sub).mkdir(parents=True, exist_ok=True)

    # 자산 복사 — 컴포지션은 **자기완결**이어야 한다. 렌더 중 바깥을 읽지 않는다.
    if not GSAP.is_file():
        raise FileNotFoundError(f"gsap 이 없습니다: {GSAP}")
    shutil.copy2(GSAP, out_dir / "vendor" / "gsap.min.js")
    for f in FONT_DIR.glob("Pretendard-*.woff2"):
        shutil.copy2(f, out_dir / "assets" / "fonts" / f.name)
    lic = FONT_DIR / "LICENSE-Pretendard.txt"
    if lic.is_file():                      # SIL OFL — 재배포 시 동봉해야 한다
        shutil.copy2(lic, out_dir / "assets" / "fonts" / lic.name)

    missing: List[str] = []
    for sc in scenes:
        if sc["image"]:
            src = proj_dir / sc["image"]
            if src.is_file():
                shutil.copy2(src, out_dir / "img" / f"{sc['no']:03d}.png")
            else:
                missing.append(f"{sc['no']}번 그림")
        if sc["audio"]:
            src = proj_dir / sc["audio"]
            if src.is_file():
                shutil.copy2(src, out_dir / "audio" / f"{sc['no']:03d}.wav")
            else:
                missing.append(f"{sc['no']}번 소리")

    html = (HEAD % {"W": W, "H": H, "title": esc(title or "덱"), "css": CSS}
            + _body(scenes, total)
            + "\n<script>\n" + _timeline(scenes) + "\n</script>\n</body></html>\n")
    (out_dir / "index.html").write_text(html, encoding="utf-8")

    return {"dir": str(out_dir), "scenes": len(scenes), "sec": total,
            "labels": sum(len(s["labels"]) for s in scenes),
            "missing": missing}
