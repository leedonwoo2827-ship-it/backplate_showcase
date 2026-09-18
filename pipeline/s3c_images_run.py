# -*- coding: utf-8 -*-
"""S3c 그림 굽기 — `이미지프롬프트.json` → `09_이미지/003.png`.

★ **이 스테이지가 터미널 둘을 하나로 만든다.** 예전에는 이 앱이 지시문 JSON 을
  뱉으면 사람이 그 파일을 들고 8765 포트의 다른 앱으로 건너가 한 장씩 눌렀다.
  그 앱을 `imgstudio/` 로 들여왔으므로 이제 같은 프로세스 안에서 부른다.

★ **큐는 이미 저쪽에 있다.** 동시 3(최대 6) · 항목별 재시도 + 지수 백오프 ·
  이어하기(있는 번호는 건너뜀) · 진행 상태를 파일에 기록 · 401 이면 즉시 전체
  중단(남은 구독 할당량을 헛되이 태우지 않는다). 여기서는 **붙이기만** 한다.

★ 파일명은 **슬라이드 번호**다(`003.png`). 지시문 JSON 의 `file` 칸이 정한
  이름과 같다 — 번호가 곧 계약이라 사람이 자리를 맞출 일이 없다.

★ 썸네일은 따로 돈다. `썸네일프롬프트.json` 은 화풍(스톱모션 퍼핏)도 파일명도
  다르고, 원래부터 글자를 안 넣는 판이라 11판에서도 바뀌는 것이 없다.
"""
from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any, Dict, List

from core import workspace as ws
from pipeline.registry import STAGES, write_cache

POLL_SEC = 3.0
# 한 장이 30~60초쯤 걸린다. 80장이면 동시 3으로 30분 안팎 — 넉넉히 둔다.
MAX_WAIT_SEC = 4 * 3600


def _payload(p: Path) -> Dict[str, Any]:
    from imgstudio.services import batch_jobs
    return batch_jobs.normalize_payload(json.loads(p.read_text(encoding="utf-8")))


def run(job, pid: int, slug: str, project: Dict[str, Any], *, force: bool = False):
    stage = STAGES["s3c-images-run"]
    from imgstudio.core.config import load_settings
    from imgstudio.services import batch_jobs

    d = ws.step_dir(pid, slug, "images")
    src = d / "이미지프롬프트.json"
    if not src.is_file():
        raise RuntimeError("이미지프롬프트.json 이 없습니다 — 먼저 지시문(s3a)을 만드세요.")

    norm = _payload(src)
    items = norm["items"]
    job.add_log(f"{len(items)}장 · 비율 {norm.get('aspect') or '기본'} "
                f"→ {norm.get('suggested_size')}")

    # ★ 이미 있는 번호는 저쪽 `skip_existing` 이 건너뛴다. 여기서도 미리 세어
    #   사람에게 알려 준다 — 「몇 장이 새로 구워지는가」가 곧 비용이다.
    have = batch_jobs.scan_existing(str(d))
    todo = [it for it in items if int(it["n"]) not in have]
    job.add_log(f"이미 있음 {len(have)}장 · 새로 구움 {len(todo)}장")
    if not todo and not force:
        return write_cache(pid, slug, "s3c-images-run",
                           input_hash=stage.input_hash(pid, slug, project),
                           data={"made": 0, "skipped": len(have), "failed": 0},
                           code_version=stage.code_version, cost_usd=0.0,
                           status="ok", warnings=[])

    st = load_settings()
    size = norm.get("suggested_size") or st.get("default_size", "auto")
    # ★ `start_job` 이 아니라 `start_job_in_thread` 다. 쇼케이스는 스테이지를
    #   **이벤트 루프가 없는 데몬 스레드**에서 돌리는데, `start_job` 은
    #   `asyncio.get_running_loop()` 을 써서 거기서는 죽는다
    #   (2026-09-18 실측: RuntimeError: no running event loop).
    bj = batch_jobs.start_job_in_thread(
        items=items, out_dir=str(d), size=size,
        deck=norm.get("deck") or project.get("title") or slug,
        workers=int(st.get("batch_workers") or batch_jobs.DEFAULT_WORKERS),
        retries=batch_jobs.DEFAULT_RETRIES,
        skip_existing=not force, with_title=False,
        fmt=st.get("default_format", "png"), to_gallery=False)
    job.add_log(f"작업 {bj.id} 시작")

    waited, last = 0.0, -1
    while True:
        time.sleep(POLL_SEC)
        waited += POLL_SEC
        cur = batch_jobs.get_job(bj.id)
        if cur is None:
            raise RuntimeError("작업이 사라졌습니다(서버 재시작?)")
        c = cur.to_dict()["counts"]
        done = int(c.get("done", 0)) + int(c.get("skipped", 0))
        if done != last:
            last = done
            job.progress(done, len(items),
                         f"실패 {c.get('failed', 0)}" if c.get("failed") else "")
        if cur.status != "running":
            break
        if getattr(job, "canceled", False):
            batch_jobs.stop_job(bj.id)
            raise RuntimeError("사람이 멈췄습니다")
        if waited > MAX_WAIT_SEC:
            batch_jobs.stop_job(bj.id)
            raise RuntimeError("너무 오래 걸려 멈췄습니다")

    final = cur.to_dict()
    c = final["counts"]
    warn: List[str] = []
    if final.get("fatal"):
        # 로그인 만료가 여기로 온다. **이름을 그대로 남긴다** — "실패"만 적으면
        # 할당량 소진인지 로그인 문제인지 사람이 알 수 없다.
        warn.append(f"전체 중단: {final['fatal']}")
    for it in final.get("items", []):
        if it.get("status") == "failed" and it.get("error"):
            warn.append(f"{it['n']}번: {it['error']}")

    job.add_log(f"만듦 {c.get('done', 0)} · 건너뜀 {c.get('skipped', 0)} · "
                f"실패 {c.get('failed', 0)}")
    return write_cache(pid, slug, "s3c-images-run",
                       input_hash=stage.input_hash(pid, slug, project),
                       data={"job": bj.id, "made": c.get("done", 0),
                             "skipped": c.get("skipped", 0),
                             "failed": c.get("failed", 0),
                             "size": size, "dir": str(d)},
                       code_version=stage.code_version, cost_usd=0.0,
                       status="degraded" if warn else "ok", warnings=warn[:10])


STAGES["s3c-images-run"].run = run
