#!/usr/bin/env python3
"""Generates one P1 (Primary 1) HK-style maths worksheet: a mix of
2-digit addition/subtraction, missing-digit column arithmetic, and one
word problem — modelled on the difficulty/format of a real P1 2nd-term
school test (see mvp/test2_answer_key.json for the reference paper).

Each run produces a unique worksheet_id, a printable HTML file, and a
JSON answer key saved under worksheets/<worksheet_id>/ so the grading
step can look up the correct answers for that specific sheet later.
"""
import json
import random
import string
import sys
from pathlib import Path

HERE = Path(__file__).parent
OUT_DIR = HERE / "worksheets"


def rand_id(n=6):
    return "".join(random.choices(string.ascii_uppercase + string.digits, k=n))


def gen_add_sub(regroup=True):
    """One horizontal 2-digit +/- question with a plain-language answer."""
    op = random.choice(["+", "-"])
    if op == "+":
        a = random.randint(10, 69)
        b = random.randint(10, 99 - a)
        answer = a + b
        text = f"{a} + {b} ="
    else:
        a = random.randint(20, 99)
        b = random.randint(10, a)
        answer = a - b
        text = f"{a} - {b} ="
    return {"type": "equation", "text": text, "answer": str(answer)}


def gen_missing_digit_sub():
    """'_8 - 3_ = NN' style: top tens digit X and subtrahend ones digit Y unknown."""
    x = random.randint(4, 9)
    y = random.randint(0, 9)
    top = x * 10 + 8
    sub = 30 + y
    result = top - sub
    if result < 10 or result > 98:
        return gen_missing_digit_sub()
    return {
        "type": "missing_digit_sub",
        "top_ones": 8,
        "sub_tens": 3,
        "result": result,
        "answer": {"top_tens_digit": str(x), "sub_ones_digit": str(y)},
        "text": f"_8 - 3_ = {result}",
    }


def gen_word_problem():
    name = random.choice(["小明", "小美", "媽媽", "哥哥"])
    kind = random.choice(["add_stickers", "add_pencils", "sub_sweets"])
    if kind == "add_stickers":
        a, b = random.randint(20, 60), random.randint(10, 40)
        text = f"{name}有{a}張貼紙,又買咗{b}張,而家一共有幾多張貼紙?"
        answer = a + b
    elif kind == "add_pencils":
        a, b = random.randint(20, 60), random.randint(10, 40)
        text = f"文具店昨天賣出鉛筆{a}支,今天再賣出{b}支,呢兩日一共賣出幾多支鉛筆?"
        answer = a + b
    else:
        a = random.randint(30, 70)
        b = random.randint(10, a - 5)
        text = f"{name}有{a}粒糖,食咗{b}粒,仲剩返幾多粒?"
        answer = a - b
    return {"type": "word_problem", "text": text, "answer": str(answer)}


def generate_worksheet():
    questions = []
    for _ in range(5):
        questions.append(gen_add_sub())
    for _ in range(2):
        questions.append(gen_missing_digit_sub())
    questions.append(gen_word_problem())
    return questions


def render_html(worksheet_id, questions):
    rows = []
    n = 1
    for q in questions:
        if q["type"] in ("equation", "word_problem"):
            rows.append(f"""
      <div class="q">
        <div class="q-text"><span class="q-num">{n}.</span> {q['text']}</div>
        <div class="ans-line"></div>
      </div>""")
        elif q["type"] == "missing_digit_sub":
            rows.append(f"""
      <div class="q">
        <div class="q-text"><span class="q-num">{n}.</span> 喺方格內填上數字</div>
        <div class="vertical-sum">
          <div class="row"><span class="box"></span><span class="digit">8</span></div>
          <div class="row"><span class="op">-</span><span class="digit">3</span><span class="box"></span></div>
          <div class="line"></div>
          <div class="row result">{q['result']:02d}</div>
        </div>
      </div>""")
        n += 1
    html = f"""<!doctype html>
<html lang="zh-HK">
<head>
<meta charset="utf-8">
<title>P1 數學工作紙 — {worksheet_id}</title>
<style>
  body{{font-family:"Noto Sans HK","PingFang HK",sans-serif; max-width:700px; margin:24px auto; color:#111;}}
  header{{text-align:center; margin-bottom:20px;}}
  header h1{{font-size:1.3rem; margin:0 0 4px;}}
  header .sub{{font-size:.85rem; color:#666;}}
  .q{{margin-bottom:26px; page-break-inside:avoid;}}
  .q-text{{font-size:1.05rem; margin-bottom:8px;}}
  .q-num{{font-weight:700; margin-right:4px;}}
  .ans-line{{border-bottom:1px solid #333; width:220px; height:28px;}}
  .vertical-sum{{font-size:1.1rem; font-family:monospace; width:120px;}}
  .vertical-sum .row{{display:flex; justify-content:flex-end; gap:6px;}}
  .vertical-sum .box{{display:inline-block; width:22px; height:22px; border:1px solid #333;}}
  .vertical-sum .digit{{display:inline-block; width:22px; text-align:center;}}
  .vertical-sum .op{{width:22px; text-align:center;}}
  .vertical-sum .line{{border-top:1px solid #333; margin:4px 0;}}
  .vertical-sum .result{{justify-content:flex-end; font-weight:700;}}
  footer{{margin-top:30px; font-size:.72rem; color:#999; text-align:center;}}
  @media print {{ .no-print{{display:none;}} }}
</style>
</head>
<body>
  <header>
    <h1>小一數學工作紙</h1>
    <div class="sub">工作紙編號: {worksheet_id}</div>
  </header>
  <div class="questions">
    {''.join(rows)}
  </div>
  <footer>做完影相send返嚟就得,唔使填名/唔使剪裁,淨係影清楚啲。</footer>
  <div class="no-print" style="text-align:center; margin-top:20px;">
    <button onclick="window.print()">打印 / 存做 PDF</button>
  </div>
</body>
</html>"""
    return html


def main():
    worksheet_id = rand_id()
    questions = generate_worksheet()
    out_dir = OUT_DIR / worksheet_id
    out_dir.mkdir(parents=True, exist_ok=True)

    html = render_html(worksheet_id, questions)
    (out_dir / "worksheet.html").write_text(html, encoding="utf-8")
    (out_dir / "answer_key.json").write_text(
        json.dumps({"worksheet_id": worksheet_id, "questions": questions}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"worksheet_id={worksheet_id}")
    print(f"html={out_dir / 'worksheet.html'}")
    print(f"answer_key={out_dir / 'answer_key.json'}")


if __name__ == "__main__":
    main()
