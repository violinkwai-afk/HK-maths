# hk-maths — Tickets

Started 2026-09-26 alongside `/api/grade`'s rewrite. Plain numbers, per
project convention (see hk-homework-check's `TICKETS.md` for why).

- ✅ **第1項：`/api/grade`重寫做OCR→code→AI設計，完全跟返hk-homework-check
  嘅架構。** 用戶明確指示。`878a7dd`（主要rewrite）+ `7d65cf5`（prompt
  fix）+ `d5d8896`（清理debug log）已push。33/33測試通過。詳細設計見
  BLUEPRINT.md。
- 🔴 **第2項：真實smoke test發現，一張完全空白（冇手寫）嘅真實sample相，
  重複問幾次，唔係每次都答「冇作答」——最少一次幻覺咗一個答案出嚟
  （仲要啱啱好係數學上啱嘅答案）。** 呢個係同hk-homework-check
  Ticket 1/9一樣嘅「唔可以老作空白位嘅答案」問題，就算已經喺prompt度
  寫明呢條規矩、temperature都設咗做0，都冇完全解決到。未做嘅嘢：
  (a) 加返好似hk-homework-check咁嘅prompt多輪打磨；(b) 用返同樣方法，
  攞真實（有真人手寫嘅）工作紙相做rigor check，先可以知道真實準繩度。
  依家個rewrite嘅架構係啱嘅方向，但未經過真實驗證，唔應該假設佢已經
  準確。
- 🔲 **第3項：未用真實有手寫答案嘅相測試過。** 而家淨係用咗一張完全空白
  嘅sample相smoke test，冇測試過真實學生手寫答案嘅辨識準繩度、
  code-compare嘅實際命中率、AI-compare嘅真實表現。
- 🔲 **第4項：`docs/external-dependencies.md`（呢個repo原有、未睇過嘅
  檔案）未review過，可能有相關資訊未睇。**
