/* ---------------------------------------------------------------------------
   앱 셸 — 사이드바(언어/화자/스텝/속도/형식), 표현 태그 칩, 생성 결과 메트릭,
   그리고 발음사전 탭 임베드.

   app.js 는 건드리지 않고 window.__s3 로만 붙는다. app.js 가 먼저 로드되므로
   여기서 채워 넣는 값들은 "호출 시점"에 읽히도록 함수로 노출한다.
--------------------------------------------------------------------------- */
(() => {
  const $ = (id) => document.getElementById(id);

  window.__s3 = window.__s3 || {};

  // ------------------------------------------------------------------ 언어
  const langSel = $('lang');

  async function loadLangs() {
    try {
      const j = await (await fetch('/api/langs')).json();
      j.langs.forEach((l) => {
        const o = document.createElement('option');
        o.value = l.code;
        // 언어 무관 모드는 코드가 na 라 "자동"임을 라벨로 분명히 한다.
        o.textContent = l.code === 'na' ? `${l.ko} — 여러 언어 섞임` : `${l.ko} · ${l.en} (${l.code})`;
        if (l.code === j.default) o.selected = true;
        langSel.appendChild(o);
      });
    } catch (e) {
      console.error('lang list failed', e);
      const o = document.createElement('option');
      o.value = 'ko'; o.textContent = '한국어 · Korean (ko)';
      langSel.appendChild(o);
    }
  }

  window.__s3.lang = () => (langSel && langSel.value) || 'ko';

  // ------------------------------------------------------------------ 화자 그리드
  // app.js 가 /api/voices 로 #voice <select> 를 채운다. 그게 끝난 뒤 그 옵션을
  // 읽어 2x5 그리드를 만든다. select 는 sr-only 로 남겨 app.js 의 .value 읽기와
  // 접근성을 함께 유지한다.
  const voiceSel = $('voice');
  const grid = $('voiceGrid');
  let previewAudio = null;

  function buildVoiceGrid() {
    if (!grid || !voiceSel || !voiceSel.options.length) return false;
    grid.innerHTML = '';
    Array.from(voiceSel.options).forEach((opt) => {
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'voice-cell';
      cell.dataset.code = opt.value;
      cell.title = opt.textContent;
      cell.textContent = opt.value;
      if (opt.textContent.includes('★')) {
        const star = document.createElement('span');
        star.className = 'voice-default';
        star.textContent = '★';
        star.title = 'voice_map.yaml 기본 화자';
        cell.appendChild(star);
      }

      const play = document.createElement('button');
      play.type = 'button';
      play.className = 'voice-play';
      play.textContent = '▶';
      play.title = `${opt.value} 목소리 미리듣기 (실제 합성이라 처음엔 몇 초 걸립니다)`;
      play.addEventListener('click', (ev) => {
        ev.stopPropagation();   // 칸 선택과 분리
        previewVoice(opt.value, play);
      });
      cell.appendChild(play);

      cell.addEventListener('click', () => selectVoice(opt.value));
      grid.appendChild(cell);
    });
    selectVoice(voiceSel.value);
    return true;
  }

  function selectVoice(code) {
    if (!code) return;
    voiceSel.value = code;
    grid.querySelectorAll('.voice-cell').forEach((c) =>
      c.classList.toggle('selected', c.dataset.code === code));
  }

  async function previewVoice(code, btn) {
    if (btn.disabled) return;
    btn.disabled = true;
    btn.classList.add('busy');
    btn.textContent = '…';
    try {
      const res = await fetch(`/api/voices/${code}/preview`);
      if (!res.ok) {
        let detail = res.statusText;
        try { detail = (await res.json()).detail || detail; } catch {}
        throw new Error(detail);
      }
      if (previewAudio) previewAudio.pause();
      previewAudio = new Audio(URL.createObjectURL(await res.blob()));
      previewAudio.play();
    } catch (e) {
      alert(`미리듣기 실패: ${e.message}`);
    } finally {
      btn.disabled = false;
      btn.classList.remove('busy');
      btn.textContent = '▶';
    }
  }

  // app.js 의 loadVoices() 는 비동기다. 옵션이 채워질 때까지 짧게 재시도한다.
  (function waitForVoices(tries = 0) {
    if (buildVoiceGrid()) return;
    if (tries > 60) return;                 // 6초면 서버가 죽은 것
    setTimeout(() => waitForVoices(tries + 1), 100);
  })();

  // ------------------------------------------------------------------ 배지
  async function refreshBadges() {
    try {
      const j = await (await fetch('/api/health')).json();
      const eng = $('badgeEngine');
      const prov = $('badgeProvider');
      if (j.engine_loaded) {
        eng.textContent = '엔진 준비됨';
        eng.className = 'badge ok';
        prov.textContent = (j.providers || ['?'])[0].replace('ExecutionProvider', '');
        if ($('badgeRate')) $('badgeRate').textContent = `${j.sample_rate} Hz`;
      } else {
        eng.textContent = '엔진 대기 중 — 첫 생성 때 로드';
        eng.className = 'badge wait';
        prov.textContent = `use_gpu=${j.use_gpu_mode}`;
      }
    } catch {
      const eng = $('badgeEngine');
      eng.textContent = '서버 연결 실패';
      eng.className = 'badge err';
    }
  }

  // ------------------------------------------------------------------ 표현 태그 칩
  const tagBar = $('tagBar');
  const pronTa = $('text');
  const warnBox = $('tagWarnings');
  let allTags = [];
  let showAllTags = false;

  const VERDICT_MARK = {
    audible: { mark: '✓', hint: '들어보고 확인됨 — 실제로 소리가 납니다' },
    silence: { mark: '~', hint: '짧은 정적만 삽입됩니다' },
    none: { mark: '✕', hint: '들어봤지만 효과 없음 — 글자로 읽히거나 무시됩니다' },
    unknown: { mark: '?', hint: '아직 안 들어봄 — 표현 태그 실험실에서 확인하세요' },
  };

  function renderTagChips() {
    if (!tagBar) return;
    tagBar.querySelectorAll('.tag-chip, .tagbar-more').forEach((n) => n.remove());
    // 기본은 공식 확인된 3종만. 나머지 7종은 "+7종 더"를 눌러야 보인다 —
    // 미확인 태그를 확인된 것처럼 나란히 놓지 않기 위해서다.
    const shown = showAllTags ? allTags : allTags.filter((t) => t.official);

    shown.forEach((t) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'tag-chip' + (t.official ? '' : ' unofficial');
      const v = VERDICT_MARK[t.verified] || VERDICT_MARK.unknown;
      chip.innerHTML = `${t.name} <code>${t.tag}</code><span class="tag-mark">${v.mark}</span>`;
      chip.title =
        `${t.tag} — ${t.effect}\n` +
        `출처: ${t.official ? 'Supertone 공식 문서' : '커뮤니티 (공식 확인 아님)'}\n` +
        `검증: ${v.hint}\n\n클릭하면 커서 위치에 넣습니다.`;
      chip.addEventListener('click', () => insertAtCursor(t.tag));
      tagBar.appendChild(chip);
    });

    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'tagbar-more';
    const hiddenCount = allTags.length - allTags.filter((t) => t.official).length;
    more.textContent = showAllTags ? '공식 3종만 보기' : `+${hiddenCount}종 더 (공식 미확인)`;
    more.title = showAllTags
      ? ''
      : '공식 문서는 태그가 10개라고만 하고 3개만 이름을 밝혔습니다. 나머지는 커뮤니티 출처라 직접 들어봐야 합니다.';
    more.addEventListener('click', () => { showAllTags = !showAllTags; renderTagChips(); });
    tagBar.appendChild(more);
  }

  function insertAtCursor(tag) {
    if (!pronTa) return;
    const start = pronTa.selectionStart ?? pronTa.value.length;
    const end = pronTa.selectionEnd ?? start;
    const before = pronTa.value.slice(0, start);
    const after = pronTa.value.slice(end);
    // 태그는 문장 안에 인라인으로 놓여야 한다. 앞뒤 공백을 알아서 맞춘다.
    const pad = (s, side) => (s && !/\s$/.test(side === 'l' ? s : ' ') ? '' : '');
    const lead = before && !/\s$/.test(before) ? ' ' : '';
    const trail = after && !/^\s/.test(after) ? ' ' : '';
    pronTa.value = before + lead + tag + trail + after;
    const pos = (before + lead + tag + trail).length;
    pronTa.setSelectionRange(pos, pos);
    pronTa.focus();
    pronTa.dispatchEvent(new Event('input', { bubbles: true }));
  }

  async function loadTags() {
    try {
      const j = await (await fetch('/api/tags')).json();
      allTags = j.tags || [];
      renderTagChips();
    } catch (e) {
      console.error('tag list failed', e);
    }
  }
  // 실험실에서 판정을 저장하면 칩의 검증 표시도 갱신돼야 한다.
  window.__s3.reloadTags = loadTags;

  // ------------------------------------------------------------------ 글자수 + 태그 경고
  const charCount = $('charCount');
  let warnTimer = null;

  function updateCharCount() {
    if (!charCount || !pronTa) return;
    const n = pronTa.value.length;
    charCount.textContent = `${n.toLocaleString()}글자`;
    // 서버가 5000자에서 422로 막는다. 미리 알려준다.
    charCount.classList.toggle('over', n > 5000);
    if (n > 5000) charCount.textContent += ' — 5,000자를 넘었습니다';
  }

  async function refreshWarnings() {
    if (!warnBox || !pronTa) return;
    const text = pronTa.value;
    if (!text.trim()) { warnBox.classList.add('hidden'); return; }
    try {
      const res = await fetch('/api/prepare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text.slice(0, 5000) }),
      });
      if (!res.ok) return;
      const j = await res.json();
      if (!j.warnings || !j.warnings.length) { warnBox.classList.add('hidden'); return; }
      warnBox.innerHTML = j.warnings.map((w) => `<p>⚠ ${escapeHtml(w)}</p>`).join('');
      warnBox.classList.remove('hidden');
    } catch { /* 경고는 부가 기능 — 실패해도 조용히 넘어간다 */ }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  if (pronTa) {
    pronTa.addEventListener('input', () => {
      updateCharCount();
      clearTimeout(warnTimer);
      warnTimer = setTimeout(refreshWarnings, 500);   // 타이핑 중 서버를 두드리지 않는다
    });
    updateCharCount();
  }

  // ------------------------------------------------------------------ 생성 결과 메트릭
  window.__s3.showMetrics = (headers) => {
    const box = $('metrics');
    if (!box || !headers) return;
    const dur = parseFloat(headers.get('X-Audio-Seconds'));
    const syn = parseFloat(headers.get('X-Synth-Seconds'));
    const rtf = parseFloat(headers.get('X-Rtf'));
    if (!Number.isFinite(dur)) { box.classList.add('hidden'); return; }
    $('mDuration').innerHTML = `${dur.toFixed(2)}<small>초</small>`;
    $('mSynth').innerHTML = `${syn.toFixed(2)}<small>초</small>`;
    $('mRtf').innerHTML = `${rtf.toFixed(2)}<small>배</small>`;
    $('mRtf').parentElement.title =
      `오디오 ${dur.toFixed(2)}초를 ${syn.toFixed(2)}초 만에 만들었습니다. ` +
      `1보다 크면 실시간보다 빠릅니다.`;
    box.classList.remove('hidden');
    refreshBadges();
  };

  // ------------------------------------------------------------------ 발음사전 탭 임베드
  // 독립 페이지 /dict 를 iframe 으로 그대로 재사용한다. dict.js 를 탭용으로
  // 다시 쓰면 검색·인라인편집·단축키 같은 기능이 미묘하게 어긋나기 쉽다.
  let dictLoaded = false;
  function mountDict() {
    if (dictLoaded) return;
    const root = $('dictRoot');
    if (!root) return;
    const f = document.createElement('iframe');
    f.src = '/dict?embed=1';
    f.title = '발음 사전';
    f.style.cssText = 'width:100%;height:calc(100vh - 240px);min-height:520px;border:1px solid var(--border);border-radius:6px;background:#fff';
    root.appendChild(f);
    dictLoaded = true;
  }

  async function refreshDictCount() {
    try {
      const j = await (await fetch('/api/dict')).json();
      const el = $('dictCountTab');
      if (el) el.textContent = j.count;
    } catch { /* 배지일 뿐 */ }
  }

  // ------------------------------------------------------------------ 탭 훅
  document.querySelectorAll('.tab').forEach((t) => {
    t.addEventListener('click', () => {
      if (t.dataset.tab === 'dict') mountDict();
      if (t.dataset.tab === 'taglab' && window.__s3.mountTaglab) window.__s3.mountTaglab();
      if (t.dataset.tab === 'api' && window.__s3.mountApiGuide) window.__s3.mountApiGuide();
    });
  });

  // ------------------------------------------------------------------ 사이드바 슬라이더
  // app.js 의 bindSlider 가 input 이벤트는 처리하지만, 초기 표시값을 안 채우고
  // 속도를 el.value 그대로 쓴다. range 의 value 는 "1.00" 을 "1" 로 정규화하므로
  // 슬라이더를 건드리기 전까지 "1" 로 보인다. 소수 두 자리로 고정한다.
  function bindSideSlider(id, valId, digits) {
    const el = $(id), v = $(valId);
    if (!el || !v) return;
    const show = () => { v.textContent = Number(el.value).toFixed(digits); };
    el.addEventListener('input', show);
    show();
  }
  bindSideSlider('speed', 'speedValue', 2);
  bindSideSlider('totalStep', 'stepValue', 0);
  bindSideSlider('batchSpeed', 'batchSpeedValue', 2);
  bindSideSlider('batchTotalStep', 'batchStepValue', 0);

  loadLangs();
  loadTags();
  refreshBadges();
  refreshDictCount();
})();
