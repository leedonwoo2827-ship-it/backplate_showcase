/* ---------------------------------------------------------------------------
   표현 태그 실험실.

   공식 문서는 태그가 10개라고 밝히면서 3개(<laugh> <breath> <sigh>)만 이름을
   공개했다. 나머지 7개는 서드파티 출처라 "정말 되는지"를 확인할 방법이 문서에
   없다. Supertonic은 문자 단위 모델이라 모르는 태그를 넣어도 에러가 안 나고
   조용히 글자로 읽히거나 무시된다.

   그래서 여기서는 같은 문장을 태그 있는 버전과 뺀 버전으로 각각 합성해서
   길이 차이를 잰다. 그 차이가 태그가 오디오를 만들었다는 유일한 객관 신호다.
   귀로 들은 판정은 config/expression_tags.yaml 에 남는다.

   메인 화면의 탭과 독립 페이지(/taglab) 양쪽에서 같은 코드를 쓴다.
--------------------------------------------------------------------------- */
(() => {
  const DEFAULT_SENTENCE = '정말 잘했어요 {tag} 자랑스럽습니다.';

  const VERDICTS = [
    { key: 'audible', label: '들림', hint: '실제로 소리가 난다' },
    { key: 'silence', label: '정적만', hint: '짧은 공백만 생긴다' },
    { key: 'none', label: '무효', hint: '아무 변화 없다' },
  ];

  const VERDICT_BADGE = {
    audible: ['✓ 들림', 'ok'],
    silence: ['~ 정적만', 'wait'],
    none: ['✕ 무효', 'err'],
    unknown: ['? 미확인', ''],
  };

  let mounted = false;
  let tags = [];
  let note = '';

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function root() {
    return document.getElementById('taglabRoot');
  }

  function sidebarVal(id, fallback) {
    const el = document.getElementById(id);
    return el ? el.value : fallback;
  }

  // ------------------------------------------------------------------ 렌더
  function render() {
    const el = root();
    if (!el) return;

    const officialCount = tags.filter((t) => t.official).length;
    const confirmed = tags.filter((t) => t.verified === 'audible').length;

    el.innerHTML = `
      <div class="lab-intro">
        <h2>표현 태그 실험실</h2>
        <p>${esc(note)}</p>
        <p class="lab-method"><strong>판정 방법</strong> — 같은 문장을 태그 <em>있는</em> 버전과
          <em>뺀</em> 버전으로 각각 합성해 길이를 비교합니다. 태그가 소리를 만들었다면 그만큼
          오디오가 길어집니다. 차이가 <code>0.15초</code> 이상이면 <strong>들림</strong>,
          <code>0.04초</code> 이상이면 <strong>정적만</strong>으로 제안합니다.
          최종 판정은 <strong>직접 들어보고</strong> 고르세요.</p>
        <div class="lab-stats">
          <span class="badge">전체 ${tags.length}종</span>
          <span class="badge ok">공식 명시 ${officialCount}종</span>
          <span class="badge wait">커뮤니티 출처 ${tags.length - officialCount}종</span>
          <span class="badge">들림 확인 ${confirmed}종</span>
        </div>
      </div>

      <div class="lab-controls">
        <label for="labSentence">테스트 문장 <small>— <code>{tag}</code> 자리에 태그가 들어갑니다</small></label>
        <input id="labSentence" type="text" value="${esc(DEFAULT_SENTENCE)}">
        <div class="lab-actions">
          <button id="labRunAll" class="primary">10종 일괄 테스트</button>
          <button id="labReset" type="button">문장 되돌리기</button>
          <span class="lab-hint">사이드바의 화자·속도·스텝 설정을 그대로 씁니다.</span>
        </div>
        <div id="labProgress" class="progress hidden">
          <div class="bar"><div id="labBar" class="fill" style="width:0%"></div></div>
          <p id="labProgressText"></p>
        </div>
      </div>

      <div class="lab-grid">
        ${tags.map(cardHtml).join('')}
      </div>
    `;

    el.querySelector('#labRunAll').addEventListener('click', runAll);
    el.querySelector('#labReset').addEventListener('click', () => {
      el.querySelector('#labSentence').value = DEFAULT_SENTENCE;
    });
    tags.forEach(wireCard);
  }

  function cardHtml(t) {
    const [badgeText, badgeCls] = VERDICT_BADGE[t.verified] || VERDICT_BADGE.unknown;
    return `
      <div class="lab-card${t.official ? ' official' : ''}" data-tag="${esc(t.tag)}">
        <div class="lab-card-head">
          <code class="lab-tag">${esc(t.tag)}</code>
          <span class="lab-name">${esc(t.name)}</span>
          <span class="badge ${badgeCls} lab-verdict">${badgeText}</span>
        </div>
        <p class="lab-effect">${esc(t.effect)}</p>
        <p class="lab-source">${t.official
          ? '<span class="src-official">공식 문서에 이름이 나온 태그</span>'
          : '<span class="src-community">커뮤니티 출처 — 공식 확인 아님</span>'}</p>

        <button type="button" class="lab-run">이 태그 테스트</button>

        <div class="lab-result hidden">
          <div class="lab-delta"></div>
          <div class="lab-players">
            <div class="lab-player">
              <span class="lab-player-label">태그 있음</span>
              <audio class="lab-audio-on" controls preload="none"></audio>
            </div>
            <div class="lab-player">
              <span class="lab-player-label">태그 뺌</span>
              <audio class="lab-audio-off" controls preload="none"></audio>
            </div>
          </div>
          <div class="lab-verdict-pick">
            <span class="lab-pick-label">들어본 결과</span>
            ${VERDICTS.map((v) => `
              <label class="lab-radio" title="${esc(v.hint)}">
                <input type="radio" name="v-${esc(t.tag)}" value="${v.key}"> ${v.label}
              </label>`).join('')}
            <span class="lab-saved"></span>
          </div>
        </div>
        <div class="lab-error error hidden"></div>
      </div>`;
  }

  function wireCard(t) {
    const card = root().querySelector(`.lab-card[data-tag="${cssEscape(t.tag)}"]`);
    if (!card) return;
    card.querySelector('.lab-run').addEventListener('click', () => runOne(t.tag, card));
    card.querySelectorAll(`input[name="v-${cssEscape(t.tag)}"]`).forEach((r) => {
      r.addEventListener('change', () => saveVerdict(t.tag, r.value, card));
    });
  }

  // querySelector 안에 들어갈 태그 문자열. <, > 는 속성값이라 안전하지만
  // CSS.escape 가 있으면 그걸 쓴다.
  function cssEscape(s) {
    return window.CSS && CSS.escape ? CSS.escape(s) : s.replace(/["\\]/g, '\\$&');
  }

  // ------------------------------------------------------------------ 실행
  async function runOne(tag, card) {
    const sentence = root().querySelector('#labSentence').value.trim() || DEFAULT_SENTENCE;
    const btn = card.querySelector('.lab-run');
    const errEl = card.querySelector('.lab-error');
    const resEl = card.querySelector('.lab-result');

    btn.disabled = true;
    btn.textContent = '합성 중… (2회)';
    errEl.classList.add('hidden');

    try {
      const res = await fetch('/api/tags/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tag,
          text: sentence,
          voice: sidebarVal('voice', null) || undefined,
          speed: parseFloat(sidebarVal('speed', '1.0')),
          total_step: parseInt(sidebarVal('totalStep', '8'), 10),
          lang: sidebarVal('lang', 'ko'),
        }),
      });
      if (!res.ok) {
        let detail = res.statusText;
        try { detail = (await res.json()).detail || detail; } catch {}
        throw new Error(detail);
      }
      const j = await res.json();

      card.querySelector('.lab-audio-on').src = wavUrl(j.wav_with);
      card.querySelector('.lab-audio-off').src = wavUrl(j.wav_without);

      const sign = j.delta_seconds >= 0 ? '+' : '';
      const cls = j.suggested_verdict === 'audible' ? 'ok'
                : j.suggested_verdict === 'silence' ? 'wait' : 'err';
      card.querySelector('.lab-delta').innerHTML =
        `<span class="lab-delta-num badge ${cls}">${sign}${j.delta_seconds.toFixed(3)}초</span>
         <span class="lab-delta-detail">태그 있음 ${j.duration_with.toFixed(2)}초 ·
           뺌 ${j.duration_without.toFixed(2)}초 → 제안:
           <strong>${(VERDICT_BADGE[j.suggested_verdict] || VERDICT_BADGE.unknown)[0]}</strong></span>`;

      // 제안값을 미리 찍어두되 저장하지는 않는다 — 저장은 사람이 듣고 고를 때만.
      const pre = card.querySelector(`input[name="v-${cssEscape(tag)}"][value="${j.suggested_verdict}"]`);
      if (pre) pre.checked = true;

      resEl.classList.remove('hidden');
      return j;
    } catch (e) {
      errEl.textContent = `테스트 실패: ${e.message}`;
      errEl.classList.remove('hidden');
      return null;
    } finally {
      btn.disabled = false;
      btn.textContent = '다시 테스트';
    }
  }

  function wavUrl(b64) {
    const bin = atob(b64);
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
  }

  async function runAll() {
    const el = root();
    const btn = el.querySelector('#labRunAll');
    const prog = el.querySelector('#labProgress');
    const bar = el.querySelector('#labBar');
    const txt = el.querySelector('#labProgressText');

    btn.disabled = true;
    prog.classList.remove('hidden');

    // 엔진이 추론 락을 하나만 쓰므로 병렬로 보내봐야 줄만 선다. 순차로 돌리고
    // 진행 상황을 보여주는 편이 정직하다. 10종 × 2회 = 20번 합성이다.
    for (let i = 0; i < tags.length; i++) {
      const t = tags[i];
      txt.textContent = `${i + 1} / ${tags.length} — ${t.tag} 합성 중 (태그 있음/뺌 2회)`;
      bar.style.width = `${Math.round((i / tags.length) * 100)}%`;
      const card = el.querySelector(`.lab-card[data-tag="${cssEscape(t.tag)}"]`);
      if (card) await runOne(t.tag, card);
    }
    bar.style.width = '100%';
    txt.textContent = `${tags.length}종 테스트 완료 — 각 카드에서 들어보고 판정을 골라주세요.`;
    btn.disabled = false;
  }

  // ------------------------------------------------------------------ 판정 저장
  async function saveVerdict(tag, verified, card) {
    const savedEl = card.querySelector('.lab-saved');
    savedEl.textContent = '저장 중…';
    try {
      const res = await fetch('/api/tags/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tag, verified }),
      });
      if (!res.ok) {
        let detail = res.statusText;
        try { detail = (await res.json()).detail || detail; } catch {}
        throw new Error(detail);
      }
      const j = await res.json();
      tags = j.tags;

      const [badgeText, badgeCls] = VERDICT_BADGE[verified] || VERDICT_BADGE.unknown;
      const badge = card.querySelector('.lab-verdict');
      badge.textContent = badgeText;
      badge.className = `badge ${badgeCls} lab-verdict`;

      savedEl.textContent = '저장됨 ✓';
      setTimeout(() => { savedEl.textContent = ''; }, 1800);

      // 한 개 합성 탭의 칩 표시도 같이 갱신한다.
      if (window.__s3 && window.__s3.reloadTags) window.__s3.reloadTags();
    } catch (e) {
      savedEl.textContent = `저장 실패: ${e.message}`;
    }
  }

  // ------------------------------------------------------------------ 마운트
  async function mount() {
    if (mounted || !root()) return;
    mounted = true;
    root().innerHTML = '<p class="hint">표현 태그를 불러오는 중…</p>';
    try {
      const j = await (await fetch('/api/tags')).json();
      tags = j.tags || [];
      note = j.note || '';
      render();
    } catch (e) {
      root().innerHTML = `<div class="error">표현 태그를 불러오지 못했습니다: ${esc(e.message)}</div>`;
      mounted = false;
    }
  }

  window.__s3 = window.__s3 || {};
  window.__s3.mountTaglab = mount;

  // 독립 페이지(/taglab)로 열렸으면 바로 띄운다.
  if (document.body.dataset.page === 'taglab') mount();
})();
