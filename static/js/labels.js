/* 라벨 자리 — 배경판(11판) 위의 글을 고치고 옮긴다.
 *
 *   위     번호 탭 (라벨이 있는 장만)
 *   좌 68  실물 면 — 16:9 그대로. 상자를 끌어 옮기고 모서리로 폭을 바꾼다
 *   우 32  라벨마다 제목·설명 입력칸
 *
 * ★ **왜 드래그인가.** 그림 모델에게 「여기를 비워라」로 자리를 못박는 길도
 *   있었지만 이 레포에 실패 기록이 있다 — 3:2 시절 「블리드칸을 비워라」를
 *   두 판에 걸쳐 시켰는데 **15장 전부가 그 칸을 넘겼다**(중앙값 85.1%).
 *   그림 모델은 판을 채우려는 성향이 강하다. 그래서 어긋난 자리는 **그림을
 *   다시 굽지 않고 여기서 옮긴다.** 돈이 안 들고 즉시 보인다.
 *
 * ★ 저장은 `deck.overrides.json` 이다 — 언제나 이긴다. 스테이지를 다시 돌려도
 *   산다. 다만 **배열을 통째로** 덮으므로, 한 번 손대면 그 장의 라벨은 사람이
 *   가져간다(내레이션 손편집과 같은 규칙). 되돌리려면 「원래대로」.
 *
 * ★ 좌표는 **%** 다. 실물 면이 몇 픽셀이든, 영상이 1920 이든 같은 자리에 앉는다.
 */
"use strict";

import { el, api, icon, toast, debounce } from "./util.js";
import { state } from "./store.js";

export const meta = {
  title: "라벨 자리",
  subtitle: "배경판 위의 글을 고치고 끌어서 옮깁니다",
  actions: () => {
    const a = el("a", "btn");
    a.href = "/preview/" + (state.projectId || 0);
    a.target = "_blank";
    a.rel = "noopener";
    a.append(icon("slide", 14), el("span", null, "슬라이드 보기"));
    return [a];
  },
};

// 상자 폭(%) — 너무 좁으면 두 글자씩 끊기고, 너무 넓으면 그림을 가린다
const MIN_W = 8;
const MAX_W = 46;

export async function mount(root, ctx) {
  const page = el("div", "page vpage");
  root.appendChild(page);
  if (!state.projectId) {
    page.appendChild(el("div", "empty", "먼저 프로젝트를 고르세요."));
    return;
  }

  let deck;
  try {
    deck = await api(`/api/projects/${state.projectId}/deck`);
  } catch (e) {
    page.appendChild(el("div", "empty", "읽지 못했습니다: " + e.message));
    return;
  }

  const slides = ((deck.ready && deck.slides) || [])
    .filter((s) => !s.drop && (s.labels || []).length && s.image);
  if (!slides.length) {
    const box = el("div", "empty");
    box.appendChild(el("p", null, "라벨이 있는 장이 없습니다."));
    box.appendChild(el("p", null,
      "배경판(11판) 프로젝트에서 그림 지시문을 만들면 여기에 나옵니다."));
    page.appendChild(box);
    return;
  }

  // ── 저장 ──────────────────────────────────────────────────────────────
  const pending = {};
  const flush = debounce(async () => {
    const keys = Object.keys(pending);
    if (!keys.length) return;
    const patch = { slides: {} };
    for (const k of keys) {
      patch.slides[k] = pending[k];
      delete pending[k];
    }
    try {
      await api(`/api/projects/${state.projectId}/overrides`,
                { method: "POST", body: { patch } });
      dirty.textContent = "저장됨";
      dirty.className = "lb-save ok";
    } catch (e) {
      dirty.textContent = "저장 실패";
      dirty.className = "lb-save err";
      toast("저장 실패: " + e.message, "err");
    }
  }, 500);

  function save(s) {
    // ★ 배열 통째로. 서버 병합이 dict 만 얕게 합치고 배열은 갈아끼운다.
    pending[String(s.src_no ?? s.no)] = { labels: s.labels };
    dirty.textContent = "저장 중…";
    dirty.className = "lb-save";
    flush();
  }

  // ── 뼈대 ──────────────────────────────────────────────────────────────
  const tabs = el("div", "lb-tabs");
  const dirty = el("span", "lb-save ok", "저장됨");
  const stage = el("div", "lb-stage");
  const side = el("div", "lb-side");
  const wrap = el("div", "lb-wrap");
  wrap.append(stage, side);
  page.append(tabs, wrap);

  let cur = slides[0];

  slides.forEach((s) => {
    const b = el("button", "lb-tab", String(s.no));
    b.title = s.title || "";
    b.onclick = () => { cur = s; draw(); };
    s._tab = b;
    tabs.appendChild(b);
  });
  tabs.appendChild(dirty);

  // ── 그리기 ────────────────────────────────────────────────────────────
  function draw() {
    slides.forEach((s) => s._tab.classList.toggle("on", s === cur));
    stage.replaceChildren();
    side.replaceChildren();

    const box = el("div", "lb-frame");
    const im = el("img");
    im.src = `/api/projects/${state.projectId}/file/${encodeURI(cur.image)}?t=${Date.now()}`;
    im.alt = "";
    box.appendChild(im);
    box.appendChild(el("h2", "lb-title", cur.title || ""));

    cur.labels.forEach((l, i) => box.appendChild(makeBox(l, i, box)));
    stage.appendChild(box);

    const head = el("div", "lb-head");
    head.append(el("strong", null, `${cur.no}. ${cur.title || ""}`),
                el("span", "muted", `라벨 ${cur.labels.length}개`));
    side.appendChild(head);

    cur.labels.forEach((l, i) => side.appendChild(makeRow(l, i)));

    const reset = el("button", "btn", "원래대로");
    reset.title = "손편집을 지우고 지시문이 만든 라벨로 되돌립니다";
    reset.onclick = async () => {
      if (!confirm("이 장의 라벨 손편집을 지울까요?")) return;
      const key = String(cur.src_no ?? cur.no);
      try {
        await api(`/api/projects/${state.projectId}/overrides`,
                  { method: "POST",
                    body: { patch: { slides: { [key]: { labels: null } } } } });
        toast("되돌렸습니다. 다시 열면 반영됩니다.");
      } catch (e) { toast("실패: " + e.message, "err"); }
    };
    side.appendChild(reset);
  }

  // 상자 하나 — 끌면 옮기고, 오른쪽 아래 손잡이를 끌면 폭이 바뀐다
  function makeBox(l, i, frame) {
    const d = el("div", "lb-box");
    d.dataset.i = String(i);
    d.style.setProperty("--lx", (l.x ?? 4) + "%");
    d.style.setProperty("--ly", (l.y ?? 14) + "%");
    d.style.setProperty("--lw", (l.w ?? 23) + "%");
    d.append(el("b", null, l.head || ""), el("span", null, l.sub || ""));
    const grip = el("i", "lb-grip");
    d.appendChild(grip);

    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
    const pct = (e) => {
      const r = frame.getBoundingClientRect();
      return { x: ((e.clientX - r.left) / r.width) * 100,
               y: ((e.clientY - r.top) / r.height) * 100 };
    };

    let mode = null;
    let off = null;

    d.addEventListener("pointerdown", (e) => {
      mode = (e.target === grip) ? "size" : "move";
      const p = pct(e);
      off = { dx: p.x - (l.x ?? 4), dy: p.y - (l.y ?? 14) };
      d.setPointerCapture(e.pointerId);
      d.classList.add("drag");
      e.preventDefault();
    });

    d.addEventListener("pointermove", (e) => {
      if (!mode) return;
      const p = pct(e);
      if (mode === "move") {
        l.x = Math.round(clamp(p.x - off.dx, 0, 100 - (l.w ?? 23)) * 10) / 10;
        l.y = Math.round(clamp(p.y - off.dy, 0, 96) * 10) / 10;
        d.style.setProperty("--lx", l.x + "%");
        d.style.setProperty("--ly", l.y + "%");
      } else {
        l.w = Math.round(clamp(p.x - (l.x ?? 4), MIN_W, MAX_W) * 10) / 10;
        d.style.setProperty("--lw", l.w + "%");
      }
      const f = side.querySelector(`.lb-row[data-i="${i}"] .lb-xy`);
      if (f) f.textContent = `x ${l.x} · y ${l.y} · 폭 ${l.w}`;
    });

    const up = (e) => {
      if (!mode) return;
      mode = null;
      d.classList.remove("drag");
      try { d.releasePointerCapture(e.pointerId); } catch (_) {}
      save(cur);
    };
    d.addEventListener("pointerup", up);
    d.addEventListener("pointercancel", up);
    return d;
  }

  // 오른쪽 입력 줄
  function makeRow(l, i) {
    const row = el("div", "lb-row");
    row.dataset.i = String(i);
    row.appendChild(el("span", "lb-n", String(i + 1)));

    const h = el("input", "lb-in");
    h.value = l.head || "";
    h.placeholder = "소제목";

    const p = el("textarea", "lb-in lb-ta");
    p.value = l.sub || "";
    p.placeholder = "설명";
    p.rows = 2;

    const redraw = () => {
      const b = stage.querySelector(`.lb-box[data-i="${i}"]`);
      if (!b) return;
      b.querySelector("b").textContent = l.head || "";
      b.querySelector("span").textContent = l.sub || "";
    };
    h.oninput = () => { l.head = h.value; redraw(); save(cur); };
    p.oninput = () => { l.sub = p.value; redraw(); save(cur); };

    row.append(h, p, el("span", "lb-xy", `x ${l.x} · y ${l.y} · 폭 ${l.w}`));
    return row;
  }

  draw();
}
