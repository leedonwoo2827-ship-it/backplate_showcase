/* "API 및 사용법" 탭 — 엔드포인트 표 + 바로 붙여넣어 쓰는 예제.
   서버가 /openapi.json 을 이미 내주므로 여기서는 자주 쓰는 것만 추려 보여준다. */
(() => {
  const ENDPOINTS = [
    ['POST', '/api/synthesize', '문장 하나 → WAV 바이트. 메트릭은 X-Audio-Seconds / X-Synth-Seconds / X-Rtf 헤더로.'],
    ['GET', '/api/voices', '화자 10종 + voice_map.yaml 매핑 전체'],
    ['GET', '/api/voices/{code}/preview', '그 화자로 짧은 문장 하나 합성 (미리듣기)'],
    ['GET', '/api/langs', '지원 언어 31종 + 언어 무관 모드 na'],
    ['GET', '/api/tags', '표현 태그 10종 + 청취 검증 상태'],
    ['POST', '/api/tags/test', '태그 A/B 합성 — 길이 차이로 효과 판정'],
    ['POST', '/api/tags/verify', '들어본 판정을 config/expression_tags.yaml 에 기록'],
    ['POST', '/api/prepare', '모델에 실제로 들어갈 문자열 + 태그 경고 미리보기'],
    ['POST', '/api/to_pronunciation', '발음사전 + 약어 음역 + 연도/단위 변환만'],
    ['GET · POST · DELETE', '/api/dict', '발음사전 조회 / 추가·수정 / 삭제 (저장 즉시 반영)'],
    ['POST', '/api/dict/preview', '사전 적용 결과 미리보기'],
    ['POST', '/api/parse_script', '대본 JSON → scene 목록 (합성 없이 확인만)'],
    ['POST', '/api/synthesize_scene', 'scene 하나 합성 → workspace 에 wav + srt 기록'],
    ['POST', '/api/batch', '대본 전체 백그라운드 일괄 합성 (job_id 반환)'],
    ['GET', '/api/jobs/{id}', '일괄 작업 진행 상황'],
    ['GET', '/api/jobs/{id}/zip', '완료된 챕터를 zip 으로 (음성 + 자막)'],
    ['POST', '/api/save_scene_srt', '편집한 자막 타임코드 저장'],
    ['POST', '/api/regenerate_chapter_srt', 'scene별 SRT 를 챕터 하나로 다시 병합'],
    ['GET', '/api/files/ch{id}/{kind}/{name}', 'workspace 파일 내려받기 (audio | subtitles)'],
    ['GET', '/api/health', '엔진 상태 · 실행 프로바이더 · 샘플레이트'],
  ];

  const CURL = `# 문장 하나 합성 (메트릭은 응답 헤더에)
curl -sS -D headers.txt -o out.wav \\
  -H "Content-Type: application/json" \\
  -d '{"text":"정말 잘했어요 <laugh> 자랑스럽습니다.","voice":"F2","lang":"ko","speed":1.0}' \\
  http://localhost:7878/api/synthesize
grep -i '^x-' headers.txt

# 표현 태그 10종 + 검증 상태
curl -sS http://localhost:7878/api/tags

# 발음사전에 항목 추가 (즉시 반영, 서버 재시작 불필요)
curl -sS -X POST -H "Content-Type: application/json" \\
  -d '{"key":"ADSL","value":"에이디에스엘"}' \\
  http://localhost:7878/api/dict`;

  const PY = `import requests

BASE = "http://localhost:7878"

# 1) 음성 + 메트릭
r = requests.post(f"{BASE}/api/synthesize", json={
    "text": "정말 잘했어요 <laugh> 자랑스럽습니다.",
    "voice": "F2",      # M1~M5 / F1~F5. 생략하면 voice_map.yaml 기본값
    "lang": "ko",       # 31개 언어 코드, 또는 "na" (언어 무관)
    "speed": 1.0,       # 0.7 ~ 2.0
    "total_step": 8,    # 5 ~ 12, 높을수록 부드럽고 느림
})
r.raise_for_status()
open("out.wav", "wb").write(r.content)
print(r.headers["X-Audio-Seconds"], "초 /",
      r.headers["X-Synth-Seconds"], "초 만에 생성 (실시간 대비",
      r.headers["X-Rtf"], "배)")

# 2) 자막까지 원하면 scene 엔드포인트를 쓴다 — wav 와 srt 가 같이 나온다
r = requests.post(f"{BASE}/api/synthesize_scene", data={
    "chapter": "01", "scene": 1,
    "text": "발음용 텍스트 <laugh>",      # 사전·태그가 적용되는 쪽
    "srt_text": "자막용 원본 텍스트",       # 태그와 사전이 적용되지 않는 쪽
    "voice": "F2",
})
print(r.json()["cues"])`;

  const PYTHON_NOTE = `Supertonic은 문자 단위(character-level) 모델이라 표현 태그가 특수 토큰이 아니라 학습된 리터럴 문자열입니다. 그래서 목록에 없는 태그를 넣어도 오류가 나지 않고 조용히 글자로 읽히거나 무시됩니다. 태그는 반드시 꺾쇠 · 소문자 · 공백 없이 쓰세요 — [laugh] 나 (웃음) 은 전처리 단계에서 글자로 남아 그대로 낭독됩니다.`;

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let mounted = false;

  function mount() {
    const el = document.getElementById('apiRoot');
    if (mounted || !el) return;
    mounted = true;

    el.innerHTML = `
      <div class="lab-intro">
        <h2>API 및 사용법</h2>
        <p>서버가 뜨면 모든 기능을 HTTP로도 쓸 수 있습니다. 대화형 문서는
          <a href="/docs" target="_blank" rel="noopener">/docs</a>,
          스키마는 <a href="/openapi.json" target="_blank" rel="noopener">/openapi.json</a>.
          인증은 없습니다 — 기본 바인딩이 <code>0.0.0.0</code>이니 신뢰할 수 없는 망에 올리지 마세요.</p>
      </div>

      <h3 class="api-h3">엔드포인트</h3>
      <div class="api-table-wrap">
        <table class="api-table">
          <thead><tr><th>메서드</th><th>경로</th><th>설명</th></tr></thead>
          <tbody>
            ${ENDPOINTS.map(([m, p, d]) => `
              <tr><td class="api-m">${esc(m)}</td><td><code>${esc(p)}</code></td><td>${esc(d)}</td></tr>
            `).join('')}
          </tbody>
        </table>
      </div>

      <h3 class="api-h3">curl</h3>
      <pre class="api-code">${esc(CURL)}</pre>

      <h3 class="api-h3">Python</h3>
      <pre class="api-code">${esc(PY)}</pre>

      <div class="tag-warnings" style="margin-top:16px">
        <p><strong>표현 태그를 API로 쓸 때</strong></p>
        <p>${esc(PYTHON_NOTE)}</p>
      </div>

      <h3 class="api-h3">환경 변수</h3>
      <div class="api-table-wrap">
        <table class="api-table">
          <thead><tr><th>이름</th><th>기본값</th><th>설명</th></tr></thead>
          <tbody>
            ${[
              ['SUPERTONIC_ASSETS_DIR', './assets', 'ONNX 모델과 voice_styles 위치'],
              ['SUPERTONIC_PROJECT_ROOT', '자동 탐색', 'config/ workspace/ 의 기준 경로를 못박음'],
              ['SUPERTONIC_PRONUNCIATION_MAP', 'config/pronunciation_map.yaml', '발음 사전'],
              ['SUPERTONIC_EXPRESSION_TAGS', 'config/expression_tags.yaml', '표현 태그 청취 검증 기록'],
              ['SUPERTONIC_VOICE_MAP', 'config/voice_map.yaml', 'voice_style → 화자 코드 매핑'],
              ['SUPERTONIC_WORKSPACE', './workspace', '일괄 합성 산출물'],
              ['SUPERTONIC_USE_GPU', 'auto', 'auto / 1 / 0'],
              ['SUPERTONIC_DEFAULT_LANG', 'ko', '기본 언어 코드'],
              ['SUPERTONIC_DEFAULT_SPEED', '1.00', '기본 속도'],
              ['SUPERTONIC_TOTAL_STEP', '8', '기본 디노이징 스텝'],
              ['SUPERTONIC_BATCH_CHUNK_SIZE', '4', '일괄 합성 청크 크기 (GPU 메모리 부족 시 낮춤)'],
              ['SUPERTONIC_HOST', '0.0.0.0', '바인딩 호스트'],
              ['SUPERTONIC_PORT', '7878', '포트'],
            ].map(([k, v, d]) => `
              <tr><td><code>${esc(k)}</code></td><td><code>${esc(v)}</code></td><td>${esc(d)}</td></tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  window.__s3 = window.__s3 || {};
  window.__s3.mountApiGuide = mount;
  if (document.body.dataset.page === 'api') mount();
})();
