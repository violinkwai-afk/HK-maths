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

Follow-up worksheets: generate_followup_worksheet() takes the concepts
a child got wrong on a previous worksheet and builds a new one that's
mostly EASIER variants of just those concepts (to rebuild the
underlying idea before going back to full difficulty), plus a couple
of normal-difficulty questions on concepts they already had right, so
it isn't 100% remedial drilling. See CONCEPTS below for what a
"concept" is and what easy/normal/hard means for each one.
"""
import json
import random
import string
from pathlib import Path

HERE = Path(__file__).parent
OUT_DIR = HERE / "worksheets"

# The three question concepts this generator knows about, and the
# generator function for each. Every generated question carries a
# "concept" field naming one of these, so a follow-up worksheet can
# look up "which generator makes more of this" from a wrong answer
# alone, without needing to inspect the question text.
CONCEPTS = ["add_sub_2digit", "missing_digit_column", "word_problem_add_sub"]


def rand_id(n=6):
    return "".join(random.choices(string.ascii_uppercase + string.digits, k=n))


def gen_add_sub(difficulty="normal"):
    """One horizontal +/- question. Difficulty controls size/regrouping:
    easy = small numbers, no regrouping (no carrying/borrowing) — rebuilds
    the basic idea. normal = 2-digit with regrouping (the standard P1
    2nd-term level). hard = bigger numbers or a 3-term sum."""
    op = random.choice(["+", "-"])
    if difficulty == "easy":
        if op == "+":
            a = random.randint(1, 5) * 10 + random.randint(0, 4)
            b_ones = random.randint(0, 9 - a % 10)
            b = random.randint(1, 4) * 10 + b_ones
            answer = a + b
            text = f"{a} + {b} ="
        else:
            a_ones = random.randint(0, 9)
            a = random.randint(2, 9) * 10 + a_ones
            b = random.randint(1, a // 10) * 10 + random.randint(0, a_ones)
            answer = a - b
            text = f"{a} - {b} ="
    elif difficulty == "hard":
        if op == "+":
            a = random.randint(20, 60)
            b = random.randint(20, 60)
            c = random.randint(5, 30)
            answer = a + b + c
            text = f"{a} + {b} + {c} ="
        else:
            a = random.randint(60, 99)
            b = random.randint(20, a - 10)
            answer = a - b
            text = f"{a} - {b} ="
    else:  # normal
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
    return {"type": "equation", "concept": "add_sub_2digit", "difficulty": difficulty, "text": text, "answer": str(answer)}


def gen_missing_digit_sub(difficulty="normal"):
    """'_8 - 3_ = NN' style column subtraction with unknown digits.
    easy = only ONE digit missing (the other given) so there's a single
    unknown to solve for. normal/hard = both digits missing, hard uses a
    3-digit top number."""
    if difficulty == "easy":
        y = random.randint(0, 9)
        x = random.randint(4, 9)
        top = x * 10 + 8
        sub = 30 + y
        result = top - sub
        if result < 10 or result > 98:
            return gen_missing_digit_sub(difficulty)
        return {
            "type": "missing_digit_sub", "concept": "missing_digit_column", "difficulty": difficulty,
            "top_ones": 8, "sub_tens": 3, "sub_ones_given": y, "result": result,
            "answer": {"top_tens_digit": str(x)},
            "text": f"_8 - 3{y} = {result}  (only the top digit is missing)",
        }
    elif difficulty == "hard":
        x = random.randint(4, 9)
        y = random.randint(0, 9)
        top = 100 + x * 10 + 8
        sub = 30 + y
        result = top - sub
        return {
            "type": "missing_digit_sub", "concept": "missing_digit_column", "difficulty": difficulty,
            "top_hundreds": 1, "top_ones": 8, "sub_tens": 3, "result": result,
            "answer": {"top_tens_digit": str(x), "sub_ones_digit": str(y)},
            "text": f"1_8 - 3_ = {result}",
        }
    else:  # normal
        x = random.randint(4, 9)
        y = random.randint(0, 9)
        top = x * 10 + 8
        sub = 30 + y
        result = top - sub
        if result < 10 or result > 98:
            return gen_missing_digit_sub(difficulty)
        return {
            "type": "missing_digit_sub", "concept": "missing_digit_column", "difficulty": difficulty,
            "top_ones": 8, "sub_tens": 3, "result": result,
            "answer": {"top_tens_digit": str(x), "sub_ones_digit": str(y)},
            "text": f"_8 - 3_ = {result}",
        }


def gen_word_problem(difficulty="normal"):
    """easy = single-step, small numbers. normal = single-step, current
    range. hard = two-step (combine an add and a subtract)."""
    name = random.choice(["Tom", "Mary", "Peter", "Ann"])
    if difficulty == "hard":
        a = random.randint(30, 60)
        b = random.randint(10, 30)
        c = random.randint(5, a + b - 5)
        text = f"{name} has {a} stickers. {name} buys {b} more, then gives {c} away. How many stickers does {name} have left?"
        answer = a + b - c
    elif difficulty == "easy":
        kind = random.choice(["add", "sub"])
        if kind == "add":
            a, b = random.randint(5, 15), random.randint(1, 9)
            text = f"{name} has {a} stickers. {name} buys {b} more stickers. How many stickers does {name} have now?"
            answer = a + b
        else:
            a = random.randint(10, 20)
            b = random.randint(1, a - 2)
            text = f"{name} has {a} sweets. {name} eats {b} of them. How many sweets are left?"
            answer = a - b
    else:  # normal
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
    return {"type": "word_problem", "concept": "word_problem_add_sub", "difficulty": difficulty, "text": text, "answer": str(answer)}


GENERATORS = {
    "add_sub_2digit": gen_add_sub,
    "missing_digit_column": gen_missing_digit_sub,
    "word_problem_add_sub": gen_word_problem,
}


def generate_worksheet():
    """The standard first-time worksheet: a normal-difficulty mix."""
    questions = []
    for _ in range(5):
        questions.append(gen_add_sub("normal"))
    for _ in range(2):
        questions.append(gen_missing_digit_sub("normal"))
    questions.append(gen_word_problem("normal"))
    return questions


def generate_followup_worksheet(previous_questions, wrong_indices):
    """Builds a targeted follow-up from a previous worksheet's results.

    previous_questions: the `questions` list from that worksheet's
    answer_key.json (each has a "concept" field).
    wrong_indices: 0-based indices into that list the child got wrong
    (or flagged) — from the grading step.

    For every concept that showed up in wrong_indices, generates 3 EASY
    questions on that concept (rebuild the idea) + 1 back at NORMAL
    difficulty (check it's actually landed). Concepts that were all
    correct get one NORMAL question each, just to keep them warm rather
    than disappearing entirely — not a full redrill.
    """
    wrong_concepts = {previous_questions[i]["concept"] for i in wrong_indices if 0 <= i < len(previous_questions)}
    all_concepts_seen = {q["concept"] for q in previous_questions}
    ok_concepts = all_concepts_seen - wrong_concepts

    questions = []
    for concept in CONCEPTS:
        gen = GENERATORS[concept]
        if concept in wrong_concepts:
            for _ in range(3):
                questions.append(gen("easy"))
            questions.append(gen("normal"))
        elif concept in ok_concepts:
            questions.append(gen("normal"))
    random.shuffle(questions)
    return questions


def _render_missing_digit_box(q):
    """Renders the right box layout for whichever difficulty this
    missing-digit question was generated at (easy has one box and a
    given ones-digit spelled out; hard has a hundreds column)."""
    if q["difficulty"] == "easy":
        sub_ones = q["sub_ones_given"]
        return f"""
          <div class="row"><span class="box"></span><span class="digit">{q['top_ones']}</span></div>
          <div class="row"><span class="op">-</span><span class="digit">{q['sub_tens']}</span><span class="digit">{sub_ones}</span></div>
          <div class="line"></div>
          <div class="row result">{q['result']:02d}</div>"""
    if q["difficulty"] == "hard":
        return f"""
          <div class="row"><span class="digit">1</span><span class="box"></span><span class="digit">{q['top_ones']}</span></div>
          <div class="row"><span class="op">-</span><span class="digit"></span><span class="digit">{q['sub_tens']}</span><span class="box"></span></div>
          <div class="line"></div>
          <div class="row result">{q['result']:03d}</div>"""
    return f"""
          <div class="row"><span class="box"></span><span class="digit">{q['top_ones']}</span></div>
          <div class="row"><span class="op">-</span><span class="digit">{q['sub_tens']}</span><span class="box"></span></div>
          <div class="line"></div>
          <div class="row result">{q['result']:02d}</div>"""


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
          <div class="vertical-sum">{_render_missing_digit_box(q)}
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
  .vertical-sum{{font-size:1.3rem; font-family:"Courier New",monospace; width:140px;}}
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
