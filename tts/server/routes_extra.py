"""supertonic3-tts 에서 새로 추가한 API 표면.

voicewright 시절 코드(routes_api.py)와 섞지 않고 따로 둔다. 이식해 온 부분과
이번에 새로 만든 부분을 나중에도 구분할 수 있어야 하기 때문이다.

  * /langs                     31개 언어 + 언어 무관(na)
  * /tags                      표현 태그 10종 + 청취 검증 상태
  * /tags/verify               들어본 결과를 config/expression_tags.yaml 에 기록
  * /tags/test                 태그 A/B 합성 — 길이 차이로 정량 판정
  * /prepare                   모델에 실제로 들어갈 문자열 + 태그 경고
  * /voices/{code}/preview     화자 그리드 ▶ 미리듣기
"""
from __future__ import annotations

import base64
import logging
from pathlib import Path

import yaml
from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, Field

from .. import langs
from .. import settings as settings_module
from .. import tags as T
from ..audio_io import to_wav_bytes
from ..engine import Engine
from ..pronunciation import load_pronunciation_map
from ..voices import ALL_VOICE_CODES, load_voice_map

logger = logging.getLogger(__name__)
router = APIRouter()


# ---------------------------------------------------------------- 언어

@router.get("/langs")
async def list_langs() -> dict:
    """Supertonic 3가 지원하는 31개 언어 + 언어 무관(na) 모드.

    벤더 helper의 AVAILABLE_LANGS가 Supertonic 2 시절 5개에 멈춰 있어서
    나머지 26개가 막혀 있었다. supertonic_tts/langs.py 참고.
    """
    s = settings_module.load()
    return {
        "langs": langs.as_dicts(),
        "default": langs.normalize(s.default_lang),
        "count": len(langs.LANGUAGES),
    }


# ---------------------------------------------------------------- 표현 태그

_TAGS_HEADER = """# Supertonic 3 표현 태그 - 청취 검증 기록
#
# 공식 README는 태그가 10개라고만 하고 3개(<laugh> <breath> <sigh>)만 이름을
# 밝혔습니다. 나머지 7개는 서드파티 통합 문서에서 가져온 것이라 공식 확인이
# 아닙니다. 그래서 앱의 "표현 태그 실험실"에서 직접 들어보고 결과를 여기에
# 기록합니다.
#
#   audible  - 확실히 들린다
#   silence  - 짧은 정적만 삽입된다
#   none     - 아무 효과 없다 (글자로 읽히거나 무시)
#   unknown  - 아직 안 들어봤다
#
# 이 파일을 지우면 코드에 들어있는 기본 추정값으로 돌아갑니다.
"""

_VALID_VERDICTS = {T.VERIFIED_AUDIBLE, T.VERIFIED_SILENCE, T.VERIFIED_NONE, T.VERIFIED_UNKNOWN}


def _read_verdicts(path: Path) -> dict[str, str]:
    if not path.exists():
        return {}
    try:
        data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    except Exception:
        logger.warning("expression_tags.yaml 파싱 실패 - 기본값을 씁니다: %s", path)
        return {}
    raw = (data.get("verified") or {}) if isinstance(data, dict) else {}
    out: dict[str, str] = {}
    for k, v in raw.items():
        tag, verdict = str(k).strip(), str(v).strip()
        if tag in T.BY_TAG and verdict in _VALID_VERDICTS:
            out[tag] = verdict
    return out


def _write_verdicts(path: Path, verdicts: dict[str, str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    header = _TAGS_HEADER
    if path.exists():
        head, sep, _ = path.read_text(encoding="utf-8").partition("verified:")
        if sep and head.strip():
            header = head  # 사용자가 손댄 헤더 주석은 보존한다
    lines = [header.rstrip("\n"), "", "verified:"]
    # 코드에 정의된 순서를 유지한다 - 사전순으로 섞으면 공식 3종이 흩어진다.
    for t in T.EXPRESSION_TAGS:
        lines.append('  "%s": %s' % (t.tag, verdicts.get(t.tag, t.verified)))
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


_TAG_NOTE = (
    "공식 문서는 태그가 10개라고 밝히면서 3개만 이름을 공개했습니다. 나머지 7개는 "
    "서드파티 통합 문서 출처이며 개수만 공식과 일치합니다. Supertonic은 문자 단위 "
    "모델이라 모르는 태그도 에러를 내지 않고 조용히 글자로 읽히므로, 직접 들어봐야 "
    "확인됩니다."
)


@router.get("/tags")
async def list_tags() -> dict:
    s = settings_module.load()
    verdicts = _read_verdicts(s.expression_tags_path)
    return {
        "tags": T.as_dicts(verdicts),
        "count": len(T.EXPRESSION_TAGS),
        "official_count": sum(1 for t in T.EXPRESSION_TAGS if t.source == T.SOURCE_OFFICIAL),
        "note": _TAG_NOTE,
    }


class TagVerdict(BaseModel):
    tag: str = Field(..., max_length=32)
    verified: str = Field(..., max_length=16)


@router.post("/tags/verify")
async def verify_tag(v: TagVerdict) -> dict:
    """실험실에서 들어본 결과를 config/expression_tags.yaml 에 기록한다."""
    if v.tag not in T.BY_TAG:
        raise HTTPException(status_code=404, detail="unknown tag: %s" % v.tag)
    if v.verified not in _VALID_VERDICTS:
        raise HTTPException(
            status_code=422,
            detail="invalid verdict: %s (허용: %s)" % (v.verified, ", ".join(sorted(_VALID_VERDICTS))),
        )
    s = settings_module.load()
    verdicts = _read_verdicts(s.expression_tags_path)
    verdicts[v.tag] = v.verified
    _write_verdicts(s.expression_tags_path, verdicts)
    return {"tags": T.as_dicts(verdicts), "saved": v.tag}


class TagTestRequest(BaseModel):
    tag: str = Field(..., max_length=32)
    text: str = Field(..., max_length=500)
    voice: str | None = None
    speed: float | None = None
    total_step: int | None = None
    lang: str | None = None


# 음소 하나가 들어갈 만한 최소 길이. 이보다 짧은 차이는 합성 흔들림으로 본다.
_AUDIBLE_DELTA = 0.15
_SILENCE_DELTA = 0.04


@router.post("/tags/test")
async def test_tag(req: TagTestRequest) -> dict:
    """태그 A/B 테스트 - 태그가 실제로 오디오를 만들었는지 정량 판정.

    같은 문장을 태그 있는 버전과 뺀 버전으로 합성해 길이 차이를 잰다.
    모델이 문자 단위라 모르는 태그도 에러를 내지 않으므로, 귀로 듣는 것 말고는
    이 길이 차이가 유일한 객관 신호다.
    """
    if req.tag not in T.BY_TAG:
        raise HTTPException(status_code=404, detail="unknown tag: %s" % req.tag)
    if "{tag}" not in req.text and req.tag not in req.text:
        raise HTTPException(
            status_code=422, detail="테스트 문장에 {tag} 자리표시자나 태그 자체가 있어야 합니다."
        )

    engine = await Engine.get()
    s = settings_module.load()
    vmap = load_voice_map(s.voice_map_path)
    voice_code = (req.voice or "").upper() or vmap.default
    if voice_code not in ALL_VOICE_CODES:
        raise HTTPException(status_code=422, detail="unknown voice: %s" % req.voice)

    with_tag = req.text.replace("{tag}", req.tag)
    without_tag = T.strip(with_tag)

    try:
        wav_on, m_on = await engine.synth_timed(
            with_tag, voice_code=voice_code, lang=req.lang,
            total_step=req.total_step, speed=req.speed,
        )
        wav_off, m_off = await engine.synth_timed(
            without_tag, voice_code=voice_code, lang=req.lang,
            total_step=req.total_step, speed=req.speed,
        )
    except Exception as exc:
        logger.exception("tag test 실패: %s", req.tag)
        raise HTTPException(status_code=500, detail="synthesis failed: %s" % exc) from exc

    delta = round(m_on["duration_seconds"] - m_off["duration_seconds"], 3)
    if delta >= _AUDIBLE_DELTA:
        verdict = T.VERIFIED_AUDIBLE
    elif delta >= _SILENCE_DELTA:
        verdict = T.VERIFIED_SILENCE
    else:
        verdict = T.VERIFIED_NONE

    return {
        "tag": req.tag,
        "voice": voice_code,
        "text_with": with_tag,
        "text_without": without_tag,
        "duration_with": m_on["duration_seconds"],
        "duration_without": m_off["duration_seconds"],
        "delta_seconds": delta,
        "suggested_verdict": verdict,
        "sample_rate": engine.sample_rate,
        "wav_with": base64.b64encode(to_wav_bytes(wav_on, engine.sample_rate)).decode(),
        "wav_without": base64.b64encode(to_wav_bytes(wav_off, engine.sample_rate)).decode(),
    }


# ---------------------------------------------------------------- 합성 전 미리보기

class PrepareRequest(BaseModel):
    text: str = Field(..., max_length=5000)


class PrepareResponse(BaseModel):
    text: str
    tags: list[str]
    warnings: list[str]


@router.post("/prepare", response_model=PrepareResponse)
async def prepare(req: PrepareRequest) -> PrepareResponse:
    """모델에 실제로 들어갈 문자열과 태그 경고를 돌려준다.

    /to_pronunciation 과 결과 문자열은 같지만, 이쪽은 표현 태그가 보존됐는지
    확인할 수 있게 태그 목록과 오타 경고를 함께 준다.
    """
    if not req.text.strip():
        return PrepareResponse(text="", tags=[], warnings=[])
    s = settings_module.load()
    pmap = load_pronunciation_map(s.pronunciation_map_path)
    converted = pmap.apply(req.text, spell_unknown_acronyms=True, convert_years=True)
    return PrepareResponse(
        text=converted, tags=T.find(converted), warnings=T.validate(req.text)
    )


# ---------------------------------------------------------------- 보이스 미리듣기

_PREVIEW_TEXT = "안녕하세요. 슈퍼토닉 3 목소리 미리듣기입니다."


@router.get("/voices/{code}/preview")
async def voice_preview(code: str, text: str | None = None) -> Response:
    """화자 그리드의 ▶ 버튼용. 짧은 문장 하나를 그 목소리로 합성해 돌려준다."""
    voice_code = code.upper()
    if voice_code not in ALL_VOICE_CODES:
        raise HTTPException(status_code=404, detail="unknown voice: %s" % code)
    engine = await Engine.get()
    try:
        wav = await engine.synth((text or _PREVIEW_TEXT)[:200], voice_code=voice_code)
    except Exception as exc:
        logger.exception("voice preview 실패: %s", voice_code)
        raise HTTPException(status_code=500, detail="synthesis failed: %s" % exc) from exc
    return Response(
        content=to_wav_bytes(wav, engine.sample_rate),
        media_type="audio/wav",
        headers={"Cache-Control": "public, max-age=3600"},
    )
