/* =====================================================================
   LUYỆN THI LUẬT HÀNH CHÍNH — app.js  (mô hình "bộ 20 câu")
   - Mỗi lượt làm = một BỘ gồm N câu (mặc định 20), được trộn ngẫu nhiên.
   - Dùng cơ chế "bốc bài": xáo toàn bộ 200 câu rồi chia thành các bộ,
     làm hết một vòng (không trùng) mới trộn lại từ đầu.
   - Làm xong hiện bảng kết quả; bấm "Bộ mới" để sang lượt khác.
   ===================================================================== */

(() => {
  "use strict";

  const STORE_KEY = "lhc_quiz_v2";   // đổi version vì cấu trúc dữ liệu mới
  const DEFAULT_SIZE = 20;

  const state = {
    questions: [],   // ngân hàng câu hỏi gốc (từ quiz.json)
    byId: new Map(), // ID -> câu hỏi
    deck: [],        // hàng đợi ID đã trộn cho vòng hiện tại
    setSize: DEFAULT_SIZE,
    flags: {},       // { [ID]: true }
    streak: 0,
    theme: "light",
    lifetime: { sets: 0, totalAnswered: 0, totalCorrect: 0, best: 0 },
    // Bộ đang làm:
    session: null,   // { ids:[], pos:0, answers:{}, kind:'normal'|'flagged', finished:false, recorded:false }
    phase: "quiz",   // 'quiz' | 'summary'
  };

  const el = {};
  const $ = (s) => document.querySelector(s);

  /* ================= KHỞI ĐỘNG ================= */
  async function init() {
    cacheDom();
    loadState();
    applyTheme();
    applySizeSeg();
    bindEvents();

    try {
      const res = await fetch("quiz.json", { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      state.questions = data.filter(q => q && q.CauHoi && q.DapAnDung);
      if (!state.questions.length) throw new Error("Tệp rỗng");
    } catch (err) {
      console.error(err);
      el.loader.hidden = true; el.errorBox.hidden = false; return;
    }

    state.byId = new Map(state.questions.map(q => [q.ID, q]));
    el.footTotal.textContent = state.questions.length;

    // Khôi phục bộ đang dở; nếu không có thì tạo bộ mới.
    if (!restoreSession()) dealSession(state.setSize, "normal");

    el.loader.hidden = true; el.app.hidden = false;
    render();
  }

  function cacheDom() {
    [
      "loader","errorBox","app","progressFill","progressText","accuracyText",
      "statCorrect","statWrong","statLeft","qbadge","qPos","qTotal","qId",
      "questionText","answers","result","resultBanner","explainText",
      "prevBtn","nextBtn","flagBtn","card","summary","scoreRing","scorePct",
      "scoreFrac","summaryTitle","summaryText","summaryGrid","reviewBtn",
      "newSetBtn","newSetBtn2","flaggedBtn","finishBtn","resetBtn","sizeSeg",
      "palette","sessionKind","themeToggle","streakBadge","streakValue",
      "paletteToggle","footTotal","lifeSets","lifeAvg","lifeBest",
    ].forEach(id => { el[id] = document.getElementById(id); });
    el.panel  = $(".panel");
    el.ansBtns = el.answers.querySelectorAll(".ans");
    el.sizeBtns = el.sizeSeg.querySelectorAll(".seg__btn");
  }

  /* ================= LƯU / ĐỌC ================= */
  function loadState() {
    try {
      const s = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
      if (s.flags)    state.flags = s.flags;
      if (s.deck)     state.deck = s.deck;
      if (s.setSize)  state.setSize = s.setSize;
      if (s.streak)   state.streak = s.streak;
      if (s.theme)    state.theme = s.theme;
      if (s.lifetime) state.lifetime = Object.assign(state.lifetime, s.lifetime);
      if (s.session)  state._savedSession = s.session;
    } catch (_) {}
  }

  function saveState() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        flags: state.flags, deck: state.deck, setSize: state.setSize,
        streak: state.streak, theme: state.theme, lifetime: state.lifetime,
        session: state.session,
      }));
    } catch (_) {}
  }

  function restoreSession() {
    const s = state._savedSession;
    if (!s || !Array.isArray(s.ids) || !s.ids.length) return false;
    // Lọc ra những ID còn tồn tại trong ngân hàng
    const ids = s.ids.filter(id => state.byId.has(id));
    if (!ids.length) return false;
    state.session = {
      ids, pos: Math.min(s.pos || 0, ids.length - 1),
      answers: s.answers || {}, kind: s.kind || "normal",
      finished: !!s.finished, recorded: !!s.recorded,
    };
    state.phase = (s.finished && s.viewSummary) ? "summary" : "quiz";
    return true;
  }

  /* ================= TRỘN & CHIA BỘ ================= */
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function allIds() { return state.questions.map(q => q.ID); }

  // Bốc N câu kế tiếp từ deck; hết vòng thì trộn lại toàn bộ.
  function drawFromDeck(n) {
    if (state.deck.length < n) state.deck = shuffle(allIds());
    return state.deck.splice(0, Math.min(n, state.deck.length));
  }

  function dealSession(size, kind) {
    let ids;
    if (kind === "flagged") {
      ids = shuffle(Object.keys(state.flags).map(Number).filter(id => state.byId.has(id)));
    } else {
      ids = drawFromDeck(size);
    }
    state.session = { ids, pos: 0, answers: {}, kind, finished: false, recorded: false };
    state.phase = "quiz";
    saveState();
  }

  /* ================= TRUY VẤN BỘ HIỆN TẠI ================= */
  const S = () => state.session;
  function currentQuestion() {
    const s = S(); return s ? state.byId.get(s.ids[s.pos]) : null;
  }
  function sessionStats() {
    const s = S(); let correct = 0, wrong = 0, answered = 0;
    if (s) for (const id of s.ids) {
      const a = s.answers[id];
      if (a != null) { answered++; (a === state.byId.get(id).DapAnDung ? correct++ : wrong++); }
    }
    return { correct, wrong, answered, total: s ? s.ids.length : 0 };
  }

  /* ================= RENDER ================= */
  function render() {
    const summaryMode = state.phase === "summary";
    el.summary.hidden = !summaryMode;
    el.card.hidden = summaryMode;
    if (summaryMode) renderSummary(); else renderQuestion();
    renderDashboard();
    renderPalette();
    renderSessionLabel();
    renderLifetime();
  }

  function renderQuestion() {
    const s = S(); const q = currentQuestion();
    if (!q) return;
    el.qPos.textContent = s.pos + 1;
    el.qTotal.textContent = s.ids.length;
    el.qId.textContent = q.ID;
    el.questionText.textContent = q.CauHoi;

    const chosen = s.answers[q.ID];
    const answered = chosen != null;

    el.ansBtns.forEach(btn => {
      btn.className = "ans " + (btn.dataset.value === "Đúng" ? "ans--true" : "ans--false");
      btn.disabled = answered;
      if (answered) {
        if (btn.dataset.value === q.DapAnDung) btn.classList.add("is-correct");
        if (btn.dataset.value === chosen && chosen !== q.DapAnDung) btn.classList.add("is-wrong");
        if (btn.dataset.value === chosen) btn.classList.add("is-chosen");
      }
    });

    if (answered) {
      const ok = chosen === q.DapAnDung;
      el.result.hidden = false;
      el.resultBanner.className = "result__banner " + (ok ? "ok" : "bad");
      el.resultBanner.textContent = ok
        ? `✓ Chính xác! Đáp án đúng là “${q.DapAnDung}”.`
        : `✗ Chưa đúng. Bạn chọn “${chosen}”, đáp án đúng là “${q.DapAnDung}”.`;
      el.explainText.textContent = q.GiaiThich || "(Không có giải thích)";
    } else {
      el.result.hidden = true;
    }

    el.flagBtn.classList.toggle("is-on", !!state.flags[q.ID]);
    el.prevBtn.disabled = s.pos === 0;

    const isLast = s.pos >= s.ids.length - 1;
    el.nextBtn.textContent = isLast ? "Xem kết quả ›" : (answered ? "Câu tiếp ›" : "Bỏ qua ›");
  }

  function renderDashboard() {
    const { correct, wrong, answered, total } = sessionStats();
    el.statCorrect.textContent = correct;
    el.statWrong.textContent = wrong;
    el.statLeft.textContent = Math.max(0, total - answered);
    el.progressFill.style.width = (total ? answered / total * 100 : 0) + "%";
    el.progressText.textContent = `${answered} / ${total} câu trong bộ này`;
    el.accuracyText.textContent = answered ? `Đúng trong bộ: ${Math.round(correct / answered * 100)}%` : "Đúng trong bộ: —";
    el.streakValue.textContent = state.streak;
    el.streakBadge.classList.toggle("is-cold", state.streak === 0);
  }

  function renderPalette() {
    const s = S(); el.palette.innerHTML = "";
    if (!s || !s.ids.length) {
      const e = document.createElement("div");
      e.className = "palette__empty"; e.textContent = "Chưa có câu nào.";
      el.palette.appendChild(e); return;
    }
    const frag = document.createDocumentFragment();
    s.ids.forEach((id, i) => {
      const q = state.byId.get(id); const a = s.answers[id];
      const cell = document.createElement("button");
      cell.className = "pcell"; cell.textContent = i + 1;
      cell.title = q.CauHoi.slice(0, 70) + (q.CauHoi.length > 70 ? "…" : "");
      if (a != null) cell.classList.add(a === q.DapAnDung ? "is-ok" : "is-bad");
      if (state.flags[id]) cell.classList.add("is-flag");
      if (state.phase === "quiz" && i === s.pos) cell.classList.add("is-current");
      cell.addEventListener("click", () => {
        state.phase = "quiz"; s.pos = i; closePanelMobile(); saveState(); render();
        el.card.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      frag.appendChild(cell);
    });
    el.palette.appendChild(frag);
  }

  function renderSessionLabel() {
    const s = S(); if (!s) return;
    el.sessionKind.textContent = (s.kind === "flagged" ? "Câu đánh dấu · " : "Ngẫu nhiên · ") + s.ids.length + " câu";
  }

  function renderLifetime() {
    const lt = state.lifetime;
    el.lifeSets.textContent = lt.sets;
    el.lifeAvg.textContent = lt.totalAnswered ? Math.round(lt.totalCorrect / lt.totalAnswered * 100) + "%" : "—";
    el.lifeBest.textContent = lt.best ? lt.best + "%" : "—";
  }

  function renderSummary() {
    const { correct, answered, total } = sessionStats();
    const pct = answered ? Math.round(correct / answered * 100) : 0;
    el.scorePct.textContent = pct + "%";
    el.scoreFrac.textContent = `${correct}/${total}`;
    el.scoreRing.style.setProperty("--pct", pct);

    let title, msg;
    if (answered < total) { title = "Đã kết thúc bộ"; msg = `Bạn trả lời ${answered}/${total} câu, đúng ${correct} câu.`; }
    else if (pct === 100) { title = "Xuất sắc! 🎉"; msg = `Trọn vẹn ${correct}/${total} câu. Quá đỉnh!`; }
    else if (pct >= 80)   { title = "Tốt lắm!"; msg = `Đúng ${correct}/${total} câu. Sắp hoàn hảo rồi.`; }
    else if (pct >= 60)   { title = "Khá ổn"; msg = `Đúng ${correct}/${total} câu. Ôn thêm chút nữa nhé.`; }
    else if (pct >= 40)   { title = "Cần cố gắng"; msg = `Đúng ${correct}/${total} câu. Xem lại phần giải thích nào.`; }
    else                  { title = "Đừng nản!"; msg = `Đúng ${correct}/${total} câu. Làm bộ mới và thử lại thôi.`; }
    el.summaryTitle.textContent = title;
    el.summaryText.textContent = msg;

    // Lưới kết quả từng câu (bấm để xem lại)
    const s = S(); el.summaryGrid.innerHTML = "";
    s.ids.forEach((id, i) => {
      const a = s.answers[id]; const correctAns = state.byId.get(id).DapAnDung;
      const cell = document.createElement("button");
      cell.className = "scell";
      if (a == null) cell.classList.add("is-skip");
      else cell.classList.add(a === correctAns ? "is-ok" : "is-bad");
      cell.textContent = i + 1;
      cell.title = a == null ? "Chưa trả lời" : (a === correctAns ? "Đúng" : "Sai");
      cell.addEventListener("click", () => { state.phase = "quiz"; s.pos = i; saveState(); render(); el.card.scrollIntoView({ behavior: "smooth" }); });
      el.summaryGrid.appendChild(cell);
    });
  }

  /* ================= HÀNH ĐỘNG ================= */
  function answer(value) {
    if (state.phase !== "quiz") return;
    const s = S(); const q = currentQuestion();
    if (!q || s.answers[q.ID] != null) return;
    s.answers[q.ID] = value;
    if (value === q.DapAnDung) state.streak++; else state.streak = 0;
    saveState(); render();
  }

  function go(delta) {
    const s = S(); if (!s) return;
    const next = s.pos + delta;
    if (next < 0) return;
    if (next >= s.ids.length) { finishSession(); return; }   // qua câu cuối -> kết quả
    s.pos = next; saveState();
    renderQuestion(); renderPalette(); renderDashboard();
    el.card.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function finishSession() {
    const s = S(); if (!s) return;
    if (!s.recorded) {
      const { correct, answered } = sessionStats();
      state.lifetime.sets += 1;
      state.lifetime.totalAnswered += answered;
      state.lifetime.totalCorrect += correct;
      if (answered === s.ids.length) {
        const pct = Math.round(correct / answered * 100);
        if (pct > state.lifetime.best) state.lifetime.best = pct;
      }
      s.recorded = true;
    }
    s.finished = true;
    state.phase = "summary";
    saveState(); render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function startNewSet() {
    const s = S(); const { answered } = sessionStats();
    if (s && !s.finished && answered > 0 &&
        !confirm("Bắt đầu bộ câu mới? Tiến độ bộ hiện tại sẽ không được tính nếu chưa kết thúc.")) return;
    dealSession(state.setSize, "normal");
    render(); window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function reviewFlagged() {
    const n = Object.keys(state.flags).length;
    if (!n) { alert("Bạn chưa đánh dấu câu nào. Hãy bấm ☆ Đánh dấu ở các câu muốn ôn lại."); return; }
    dealSession(0, "flagged");
    render(); window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function toggleFlag() {
    const q = currentQuestion(); if (!q) return;
    if (state.flags[q.ID]) delete state.flags[q.ID]; else state.flags[q.ID] = true;
    saveState(); el.flagBtn.classList.toggle("is-on", !!state.flags[q.ID]); renderPalette();
  }

  function chooseSize(size) {
    state.setSize = size;
    applySizeSeg();
    const s = S(); const { answered } = sessionStats();
    if (s && !s.finished && answered > 0) {
      if (confirm(`Bắt đầu bộ mới với ${size} câu?`)) { dealSession(size, "normal"); render(); window.scrollTo({ top: 0, behavior: "smooth" }); }
    } else {
      dealSession(size, "normal"); render();
    }
    saveState();
  }
  function applySizeSeg() {
    el.sizeBtns.forEach(b => b.classList.toggle("is-active", +b.dataset.size === state.setSize));
  }

  function resetAll() {
    if (!confirm("Xoá TOÀN BỘ tiến độ (thống kê, đánh dấu, bộ đang làm)?\nHành động này không thể hoàn tác.")) return;
    state.flags = {}; state.deck = []; state.streak = 0;
    state.lifetime = { sets: 0, totalAnswered: 0, totalCorrect: 0, best: 0 };
    dealSession(state.setSize, "normal");
    saveState(); render(); window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function toggleTheme() { state.theme = state.theme === "light" ? "dark" : "light"; applyTheme(); saveState(); }
  function applyTheme() { document.body.setAttribute("data-theme", state.theme); }

  function togglePanelMobile() {
    el.panel.classList.toggle("is-open");
    document.body.classList.toggle("panel-open", el.panel.classList.contains("is-open"));
  }
  function closePanelMobile() { el.panel.classList.remove("is-open"); document.body.classList.remove("panel-open"); }

  /* ================= SỰ KIỆN ================= */
  function bindEvents() {
    el.ansBtns.forEach(b => b.addEventListener("click", () => answer(b.dataset.value)));
    el.prevBtn.addEventListener("click", () => go(-1));
    el.nextBtn.addEventListener("click", () => go(1));
    el.flagBtn.addEventListener("click", toggleFlag);
    el.newSetBtn.addEventListener("click", startNewSet);
    el.newSetBtn2.addEventListener("click", startNewSet);
    el.flaggedBtn.addEventListener("click", reviewFlagged);
    el.finishBtn.addEventListener("click", () => {
      const { answered, total } = sessionStats();
      if (answered < total && !confirm(`Bạn mới làm ${answered}/${total} câu. Kết thúc và xem kết quả?`)) return;
      finishSession();
    });
    el.reviewBtn.addEventListener("click", () => { const s = S(); state.phase = "quiz"; s.pos = 0; saveState(); render(); el.card.scrollIntoView({ behavior: "smooth" }); });
    el.resetBtn.addEventListener("click", resetAll);
    el.themeToggle.addEventListener("click", toggleTheme);
    el.paletteToggle.addEventListener("click", togglePanelMobile);
    el.sizeBtns.forEach(b => b.addEventListener("click", () => chooseSize(+b.dataset.size)));

    document.addEventListener("keydown", (e) => {
      if (e.target.matches("input, textarea")) return;
      switch (e.key.toLowerCase()) {
        case "d": answer("Đúng"); break;
        case "s": answer("Sai"); break;
        case "f": if (state.phase === "quiz") toggleFlag(); break;
        case "arrowright": if (state.phase === "quiz") go(1); break;
        case "arrowleft": if (state.phase === "quiz") go(-1); break;
      }
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
