#!/usr/bin/env python3
"""Minimal local server tying the worksheet loop together:

  POST /api/generate         -> creates a new worksheet, returns its id + URL
  GET  /worksheets/<id>/...  -> serves the printable worksheet + answer key
  POST /api/submit/<id>      -> accepts a photo of the completed worksheet

IMPORTANT — what /api/submit does NOT yet do:
This endpoint currently just stores the uploaded photo next to the
worksheet's answer key and marks it "awaiting grading". It does NOT
automatically read the handwriting and grade it, because that step
needs to call a vision-capable AI (e.g. the Anthropic API) over the
network, which needs an API key this environment does not have
configured (see NEEDS_API_KEY below). Wire that in once the key exists
by calling `run_grading(worksheet_id)` -- everything else (the file
layout, the answer key format) is already set up for it.

This is a local dev server (Flask's built-in server), not a production
deployment -- fine for testing the loop end-to-end on one machine.
"""
import json
import os
import uuid
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory, abort

from generate_worksheet import generate_worksheet, render_html, rand_id

HERE = Path(__file__).parent
WORKSHEETS_DIR = HERE / "worksheets"
NEEDS_API_KEY = os.environ.get("ANTHROPIC_API_KEY") is None

app = Flask(__name__)


@app.route("/api/generate", methods=["POST"])
def api_generate():
    worksheet_id = rand_id()
    questions = generate_worksheet()
    out_dir = WORKSHEETS_DIR / worksheet_id
    out_dir.mkdir(parents=True, exist_ok=True)

    html = render_html(worksheet_id, questions)
    (out_dir / "worksheet.html").write_text(html, encoding="utf-8")
    (out_dir / "answer_key.json").write_text(
        json.dumps({"worksheet_id": worksheet_id, "questions": questions}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return jsonify({
        "worksheet_id": worksheet_id,
        "worksheet_url": f"/worksheets/{worksheet_id}/worksheet.html",
    })


@app.route("/worksheets/<worksheet_id>/<path:filename>")
def serve_worksheet_file(worksheet_id, filename):
    d = WORKSHEETS_DIR / worksheet_id
    if not d.is_dir():
        abort(404)
    return send_from_directory(d, filename)


@app.route("/api/submit/<worksheet_id>", methods=["POST"])
def api_submit(worksheet_id):
    d = WORKSHEETS_DIR / worksheet_id
    if not d.is_dir():
        return jsonify({"error": "unknown worksheet_id"}), 404
    if "photo" not in request.files:
        return jsonify({"error": "no photo uploaded (expected multipart field 'photo')"}), 400

    photo = request.files["photo"]
    submission_id = uuid.uuid4().hex[:8]
    submissions_dir = d / "submissions"
    submissions_dir.mkdir(exist_ok=True)
    photo_path = submissions_dir / f"{submission_id}_{photo.filename}"
    photo.save(photo_path)

    if NEEDS_API_KEY:
        return jsonify({
            "status": "received_not_graded",
            "submission_id": submission_id,
            "message": (
                "Photo saved, but automatic grading is not wired up yet -- "
                "this server has no ANTHROPIC_API_KEY configured, so it "
                "cannot call a vision model to read the handwriting. "
                "Set that up, then implement run_grading() to compare the "
                "read answers against this worksheet's answer_key.json."
            ),
        }), 202

    # Placeholder for when a vision API key is configured:
    # result = run_grading(worksheet_id, photo_path)
    # return jsonify(result)
    return jsonify({"status": "grading_not_implemented"}), 501


@app.route("/health")
def health():
    return jsonify({"ok": True, "needs_api_key": NEEDS_API_KEY})


if __name__ == "__main__":
    WORKSHEETS_DIR.mkdir(exist_ok=True)
    port = int(os.environ.get("PORT", 5055))
    print(f"hk-maths dev server on http://127.0.0.1:{port}  (needs_api_key={NEEDS_API_KEY})")
    app.run(host="127.0.0.1", port=port, debug=False)
