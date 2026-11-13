/* Open RO PV Scanner - Indian number plate clean-up.
   Turns raw OCR text into the most likely plate number, fixing letter/digit
   mix-ups by position (state letters, district digits, series letters, number).
   Works in the browser (window.Plate) and in Node (module.exports) for tests. */
(function (root) {
  "use strict";

  // Same shape test as open_ro_engine.py (REG_SHAPE), so the tool and scanner agree.
  var REG_SHAPE = /^([A-Z]{2}\d{1,2}[A-Z]{0,3}\d{1,4}|\d{2}BH\d{4}[A-Z]{1,2}|T\d{4}[A-Z]{2}\d{4}[A-Z]{0,2})$/;

  var STATES = ("AN AP AR AS BR CG CH DD DL DN GA GJ HP HR JH JK KA KL LA LD MH ML MN MP MZ " +
                "NL OD OR PB PY RJ SK TN TR TS UK UA UP WB").split(" ");

  // OCR look-alikes
  var TO_DIGIT = { O: "0", D: "0", Q: "0", U: "0", I: "1", L: "1", J: "1", T: "7", Z: "2", S: "5",
                   B: "8", G: "6", A: "4", E: "8", H: "4", Y: "4" };
  var TO_LETTER = { "0": "O", "1": "I", "2": "Z", "4": "A", "5": "S", "6": "G", "7": "T", "8": "B", "3": "B", "9": "P" };

  function clean(s) {
    return String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  }
  function isL(c) { return c >= "A" && c <= "Z"; }
  function isD(c) { return c >= "0" && c <= "9"; }

  // Convert a segment to letters/digits; returns {text, cost} or null.
  function asLetters(seg) {
    var out = "", cost = 0;
    for (var i = 0; i < seg.length; i++) {
      var c = seg[i];
      if (isL(c)) { out += c; continue; }
      if (TO_LETTER[c]) { out += TO_LETTER[c]; cost += 1; continue; }
      return null;
    }
    return { text: out, cost: cost };
  }
  function asDigits(seg) {
    var out = "", cost = 0;
    for (var i = 0; i < seg.length; i++) {
      var c = seg[i];
      if (isD(c)) { out += c; continue; }
      if (TO_DIGIT[c]) { out += TO_DIGIT[c]; cost += 1; continue; }
      return null;
    }
    return { text: out, cost: cost };
  }

  /* State code (first two letters): the reader can only be right if it is a REAL state code.
     Try every look-alike - digit/letter (0 -> D) and letter/letter (W -> H, F -> D) - and keep
     the closest real code. Sahib 14-Nov: "WR" or "FL" can never be right; HR / DL can. */
  var STATE_ALT = {
    "0": ["D", "O", "Q"], "1": ["I", "J"], "2": ["Z"], "3": ["B"], "4": ["A"], "5": ["S"], "6": ["G"],
    "7": ["T"], "8": ["B"], "9": ["P"],
    O: ["D", "Q"], Q: ["D", "O"], U: ["J", "D", "V"], J: ["D", "U"], I: ["L", "J"],
    W: ["H", "M", "N"], M: ["H", "N", "W"], N: ["H", "M"], H: ["N", "M", "K"], K: ["X", "H"], X: ["K"],
    F: ["D", "P", "E"], E: ["F", "B"], P: ["D", "B", "R"], B: ["D", "P", "R"], R: ["B", "P"],
    T: ["J"], C: ["G"], G: ["C"], V: ["U", "Y"], Y: ["V"], L: ["I"]
  };
  // tie-break between real codes: the states seen most in the PVs win
  var STATE_PRIOR = { DL: 0, HR: 0.02, UP: 0.04, PB: 0.06, CH: 0.06, HP: 0.08, RJ: 0.08 };
  function asState(seg) {
    var opts = [{ text: "", cost: 0 }];
    for (var i = 0; i < seg.length; i++) {
      var c = seg[i], next = [];
      opts.forEach(function (o) {
        if (isL(c)) next.push({ text: o.text + c, cost: o.cost });
        (STATE_ALT[c] || []).forEach(function (a) { next.push({ text: o.text + a, cost: o.cost + 1 }); });
      });
      opts = next;
    }
    var best = null;
    opts.forEach(function (o) {
      if (STATES.indexOf(o.text) < 0) return;
      var c = o.cost + (o.text in STATE_PRIOR ? STATE_PRIOR[o.text] : 0.1);
      if (!best || c < best.c) best = { text: o.text, cost: o.cost, c: c };
    });
    if (best) return { text: best.text, cost: best.cost };
    var plain = asLetters(seg);
    return plain;
  }

  // Best standard-plate reading of a string: SS DD [LLL] NNNN
  function bestStandard(s) {
    var best = null;
    for (var d = 1; d <= 2; d++) {
      for (var l = 0; l <= 3; l++) {
        for (var n = 1; n <= 4; n++) {
          if (2 + d + l + n !== s.length) continue;
          var st = asState(s.substr(0, 2)); if (!st) continue;
          var di = asDigits(s.substr(2, d)); if (!di) continue;
          var se = asLetters(s.substr(2 + d, l)); if (!se) continue;
          var nu = asDigits(s.substr(2 + d + l, n)); if (!nu) continue;
          var cost = st.cost + di.cost + se.cost + nu.cost;
          if (STATES.indexOf(st.text) < 0) cost += 3;      // not a real state code
          if (n < 4) cost += (4 - n) * 1.5;                 // almost all plates have 4 digits
          if (/^0+$/.test(di.text)) cost += 3;              // district 0 / 00 does not exist
          else if (d === 1) cost += st.text === "DL" ? 0.2 : 1.2; // single-digit districts: mostly Delhi
          if (st.text === "DL" && +di.text > 14) cost += 0.5; // Delhi districts run 1-14: tie-break only, ruleProblem() flags it
          if (/[IO]/.test(se.text)) cost += 1.5;            // series letters never use I or O (they read as 1 / 0)
          if (st.text === "DL" && se.text && se.text[0] !== "C" && l >= 1) cost += 0.6; // Delhi car series start with C
          if (l === 0) cost += 0.8;                         // old plates without series are rare now
          var txt = st.text + di.text + se.text + nu.text;
          if (!best || cost < best.cost) best = { plate: txt, cost: cost, kind: "standard" };
        }
      }
    }
    return best;
  }

  // BH series: YY BH NNNN L{1,2}
  function bestBH(s) {
    var best = null;
    for (var l = 1; l <= 2; l++) {
      if (s.length !== 8 + l) continue;
      var yy = asDigits(s.substr(0, 2)), bh = asLetters(s.substr(2, 2)),
          nu = asDigits(s.substr(4, 4)), le = asLetters(s.substr(8, l));
      if (!yy || !bh || !nu || !le || bh.text !== "BH") continue;
      var cost = yy.cost + bh.cost + nu.cost + le.cost;
      if (!best || cost < best.cost) best = { plate: yy.text + "BH" + nu.text + le.text, cost: cost, kind: "bh" };
    }
    return best;
  }

  /* Read the plate out of raw OCR text. Tries the whole string and every
     window inside it (OCR often adds IND, edge marks or dealer text).
     Returns {plate, cost, kind, raw} or null. */
  function parse(raw) {
    var s = clean(raw);
    if (!s) return null;
    var cands = [];
    var bases = [s];
    if (s.indexOf("IND") === 0) bases.push(s.substr(3));
    if (s.length > 3 && s.lastIndexOf("IND") === s.length - 3) bases.push(s.substr(0, s.length - 3));
    bases.forEach(function (b) {
      for (var len = Math.min(11, b.length); len >= 6; len--) {
        for (var st = 0; st + len <= b.length; st++) {
          var w = b.substr(st, len);
          var trimmed = b.length - len;                     // characters thrown away
          var r1 = bestStandard(w), r2 = bestBH(w);
          [r1, r2].forEach(function (r) {
            if (r) { r.cost += trimmed * 0.9; cands.push(r); }
          });
        }
      }
    });
    if (!cands.length) return null;
    cands.sort(function (a, b) { return a.cost - b.cost || b.plate.length - a.plate.length; });
    var top = cands[0];
    top.raw = s;
    return top;
  }

  function norm(v) {
    var s = clean(v);
    return ["", "NAN", "NONE", "REGNO", "NA", "NAT"].indexOf(s) >= 0 ? null : s;
  }
  function looksLikeReg(v) { return REG_SHAPE.test(clean(v)); }
  /* Problem with a plate-shaped number that the shape test alone misses, or "" if none:
     a state code that does not exist (WR, FL), or a Delhi district above 14. */
  function ruleProblem(v) {
    var s = clean(v);
    if (/^\d{2}BH/.test(s) || /^T\d{4}/.test(s) || !REG_SHAPE.test(s)) return "";
    var st = s.substr(0, 2);
    if (STATES.indexOf(st) < 0) return "State code " + st + " doesn't exist. Check the first two letters (HR, DL, UP...).";
    var m = s.match(/^DL(\d{1,2})/);
    if (m && +m[1] > 14) return "Delhi districts go up to 14 (DL " + m[1] + " is unusual). Check the plate.";
    return "";
  }

  var api = { parse: parse, clean: clean, norm: norm, looksLikeReg: looksLikeReg, ruleProblem: ruleProblem,
              STATES: STATES, REG_SHAPE: REG_SHAPE };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Plate = api;
})(this);
