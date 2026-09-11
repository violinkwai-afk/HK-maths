#!/usr/bin/env python3
"""Generates one P1 (Primary 1) HK-style maths worksheet: a mix of
2-digit addition/subtraction, missing-digit column arithmetic, and one
word problem — modelled on the difficulty/format of a real P1 2nd-term
school test (see mvp/test2_answer_key.json for the reference paper).

Content is in plain, simple English (a P1 HK pupil reading level) for
now, and the layout is styled to look like a real school test paper
(name/class/date/score header, numbered sections with mark weightings)
rather than a bare list of questions.

Each run produces a unique worksheet_id, a printable HTML file, and a
JSON answer key saved under worksheets/<worksheet_id>/ so the grading
step can look up the correct answers for that specific sheet later.
"""
import json
import random
import string
from pathlib import Path

HERE = Path(__file__).parent
OUT_DIR = HERE / "worksheets"


def rand_id(n=6):
    return "".join(random.choices(string.ascii_uppercase + string.digits, k=n))


def gen_add_sub():
    """One horizontal 2-digit +/- question."""
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
    name = random.choice(["Tom", "Mary", "Peter", "Ann"])
    kind = random.choice(["add_stickers", "add_pencils", "sub_sweets"])
    if kind == "add_stickers":
        a, b = random.randint(20, 60), random.randint(10, 40)
        text = f"{name} has {a} stickers. {name} buys {b} more stickers. How many stickers does {name} have now?"
        answer = a + b
    elif kind == "add_pencils":
        a, b = random.randint(20, 60), random.randint(10, 40)
        text = f"A shop sold {a} pencils yesterday. It sold {b} more pencils today. How many pencils were sold in total?"
        answer = a + b
    else:
        a = random.randint(30, 70)
        b = random.randint(10, a - 5)
        text = f"{name} has {a} sweets. {name} eats {b} of them. How many sweets are left?"
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
    section1_rows = []
    section2_rows = []
    section3_rows = []
    n = 1
    for q in questions:
        if q["type"] == "equation":
            section1_rows.append(f"""
        <div class="q">
          <div class="q-text"><span class="q-num">{n}.</span> {q['text']}</div>
          <div class="ans-line"></div>
        </div>""")
            n += 1
    for q in questions:
        if q["type"] == "missing_digit_sub":
            section2_rows.append(f"""
        <div class="q">
          <div class="q-label"><span class="q-num">{n}.</span></div>
          <div class="vertical-sum">
            <div class="row"><span class="box"></span><span class="digit">8</span></div>
            <div class="row"><span class="op">-</span><span class="digit">3</span><span class="box"></span></div>
            <div class="line"></div>
            <div class="row result">{q['result']:02d}</div>
          </div>
        </div>""")
            n += 1
    for q in questions:
        if q["type"] == "word_problem":
            section3_rows.append(f"""
        <div class="q wide">
          <div class="q-text"><span class="q-num">{n}.</span> {q['text']}</div>
          <div class="ans-line wide"></div>
        </div>""")
            n += 1

    total_marks = len(questions)
    html = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>P1 Maths Worksheet — {worksheet_id}</title>
<style>
  body{{font-family:Arial,Helvetica,sans-serif; max-width:720px; margin:20px auto; color:#111; padding:0 16px;}}
  .paper-title{{text-align:center; font-size:1.3rem; font-weight:700; margin-bottom:2px;}}
  .paper-sub{{text-align:center; font-size:.8rem; color:#888; margin-bottom:18px;}}
  .section-title{{font-weight:700; font-size:1.15rem; margin:26px 0 12px; border-bottom:2px solid #333; padding-bottom:4px;}}
  .q{{margin-bottom:26px; page-break-inside:avoid;}}
  .q-text{{font-size:1.3rem; margin-bottom:10px;}}
  .q-num{{font-weight:700; margin-right:4px;}}
  .ans-line{{border-bottom:1px solid #333; width:180px; height:26px; display:inline-block;}}
  .ans-line.wide{{width:100%; max-width:420px; display:block;}}
  .section2-grid{{display:flex; flex-wrap:wrap; gap:28px;}}
  .section2-grid .q{{display:flex; align-items:center; gap:10px;}}
  .vertical-sum{{font-size:1.3rem; font-family:"Courier New",monospace; width:130px;}}
  .vertical-sum .row{{display:flex; justify-content:flex-end; gap:6px;}}
  .vertical-sum .box{{display:inline-block; width:28px; height:28px; border:1.5px solid #333;}}
  .vertical-sum .digit{{display:inline-block; width:28px; text-align:center;}}
  .vertical-sum .op{{width:28px; text-align:center;}}
  .vertical-sum .line{{border-top:1.5px solid #333; margin:4px 0;}}
  .vertical-sum .result{{justify-content:flex-end; font-weight:700;}}
  .footnote{{margin-top:30px; font-size:.75rem; color:#888; text-align:center; border-top:1px dashed #ccc; padding-top:10px;}}
  @media print {{ .no-print{{display:none;}} }}
</style>
</head>
<body>
  <div class="paper-title">Primary 1 Maths Practice</div>
  <div class="paper-sub">Worksheet ID: {worksheet_id}</div>

  <div class="section-title">(1) Work out the answers.</div>
  <div class="section1">
    {''.join(section1_rows)}
  </div>

  <div class="section-title">(2) Fill in the missing digits.</div>
  <div class="section2-grid">
    {''.join(section2_rows)}
  </div>

  <div class="section-title">(3) Word problem.</div>
  <div class="section3">
    {''.join(section3_rows)}
  </div>

  <div class="footnote">Done? Take one clear photo of this whole page and send it back — no need to check the answers yourself.</div>
  <div class="no-print" style="text-align:center; margin-top:20px;">
    <button onclick="window.print()">Print / Save as PDF</button>
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
