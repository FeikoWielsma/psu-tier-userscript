/*
 * PSU tier matcher - single source of truth.
 *
 * This module is consumed two ways:
 *   - Node tests `require()` it directly (tests/test_matching.js).
 *   - generate_userscript.py inlines it verbatim into psutier.user.js.
 * So it must stay dependency-free and DOM-free. The `module.exports` at the
 * bottom is guarded and harmless in the browser.
 *
 * Approach: instead of a pile of per-product regex hacks, we tokenize both the
 * product name and each candidate model, then score a weighted token overlap
 * (Jaccard). Wattage is a hard gate; efficiency mismatch is a soft penalty.
 * The winning score doubles as a confidence value, which the UI turns into a
 * solid vs. "likely" badge. Tuning lives in data/normalization_rules.json.
 */
(function (root) {
  'use strict';

  // ---- text helpers -------------------------------------------------------

  function normKey(s) {
    return (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  // Split on non-alphanumerics, and split *long* (3+) digit runs off adjacent
  // letters - those are embedded wattages/years ("RM850x" -> ["rm","850","x"],
  // "C2024" -> ["c","2024"]). Short codes stay glued so "GF3" and "A3" don't
  // both reduce to a shared "3" token ("GF3" -> ["gf3"], "A3" -> ["a3"]).
  function tokenize(s) {
    return (s || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/([a-z])([0-9]{3,})/g, '$1 $2')
      .replace(/([0-9]{3,})([a-z])/g, '$1 $2')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
  }

  function applyRules(name, ruleList) {
    let out = name;
    for (const rule of (ruleList || [])) {
      try {
        out = out.replace(new RegExp(rule.pattern, rule.flags || ''), rule.replace);
      } catch { /* a bad rule shouldn't break matching */ }
    }
    return out;
  }

  // `strip` rules run on BOTH product names and candidate models: they remove
  // descriptors that are inconsistent across the sheet/PCPP/Tweakers and never
  // identify a model (ATX version tags, "80+" rating prefix, ...).
  function stripDescriptors(name, rules) {
    return applyRules(name, rules.strip);
  }

  // ---- brand index --------------------------------------------------------

  // Derive lookup keys from a brand string like "FSP (Fortron/Sparkle)" or
  // "Antec/Atom": the full normalized form plus each alias token.
  function brandKeys(brand) {
    const keys = new Set();
    const full = normKey(brand);
    if (full) keys.add(full);                 // always keep the full brand name
    const tokens = brand.replace(/[/()]/g, ' ').split(/\s+/);
    for (const t of tokens) {
      const k = normKey(t);
      if (k.length >= 3) keys.add(k);          // alias words, but skip short
    }                                          // ones ("be") that match anything
    return keys;
  }

  // Brands lead these product listings and are whole words, so match a brand
  // key against the *leading token prefix* (longest wins) rather than doing a
  // substring search - otherwise e.g. "Super Flower"'s alias "super" would
  // hijack "EVGA SuperNOVA". Returns the matched key + the remaining tokens.
  function detectBrand(tokens, byBrand) {
    let acc = '';
    let best = null;
    let bestN = 0;
    for (let i = 0; i < tokens.length && i < 6; i++) {
      acc += normKey(tokens[i]);
      if (byBrand[acc] && acc.length > (best ? best.length : 0)) {
        best = acc;
        bestN = i + 1;
      }
    }
    return best ? { key: best, rest: tokens.slice(bestN) } : null;
  }

  function buildIndex(psuData, rules) {
    const byBrand = {};         // brandKey -> [entry, ...]
    for (const entry of psuData) {
      // A model may carry "/"-separated aliases, e.g. "Pro / Pro RGB".
      const names = stripDescriptors(String(entry.model || entry.series || ''), rules)
        .split('/')
        .map((s) => s.trim())
        .filter(Boolean);
      const enriched = Object.assign({}, entry, { _tokens: names.map(tokenize) });
      for (const k of brandKeys(entry.brand)) {
        (byBrand[k] || (byBrand[k] = [])).push(enriched);
      }
    }
    return { byBrand: byBrand, rules: rules };
  }

  // ---- scoring ------------------------------------------------------------

  function tokenWeight(tok, generic) {
    if (generic.has(tok)) return 0.3;          // common marketing words
    if (/[0-9]/.test(tok)) return 2.0;         // model numbers / years
    if (tok.length === 1) return 0.5;          // suffix letters (RM-x, M)
    if (tok.length >= 3) return 1.5;
    return 1.0;
  }

  function weighted(tokens, generic) {
    let sum = 0;
    for (const t of tokens) sum += tokenWeight(t, generic);
    return sum;
  }

  // Release years (2019) and version tags (v2) are disambiguators that
  // storefronts routinely omit. When such a token is present only on the
  // candidate, it should barely penalize - the product is just a less-specified
  // listing of the same unit, not a different one.
  function isSoftToken(t) {
    return /^(19|20)\d\d$/.test(t) || /^v\d+$/.test(t);
  }

  function parseWattages(spec) {
    // Returns { discrete: [..], range: [min,max] | null }
    if (!spec) return null;
    const clean = spec.toLowerCase().replace(/w/g, '');
    if (clean.indexOf('-') !== -1) {
      const parts = clean.split('-').map((p) => parseInt(p, 10)).filter((n) => !isNaN(n));
      if (parts.length >= 2) return { range: [parts[0], parts[parts.length - 1]] };
    }
    const discrete = clean.split('/').map((p) => parseInt(p, 10)).filter((n) => !isNaN(n));
    return discrete.length ? { discrete } : null;
  }

  function wattageOk(spec, productWattage) {
    if (!spec || spec === 'All PSUs' || !productWattage) return true;
    const p = parseWattages(spec);
    if (!p) return true;
    if (p.range) return productWattage >= p.range[0] && productWattage <= p.range[1];
    return p.discrete.some((w) => Math.abs(w - productWattage) < 10);
  }

  const EFF = ['gold', 'bronze', 'silver', 'platinum', 'titanium'];
  function efficiencyOf(text) {
    const t = (text || '').toLowerCase();
    for (const e of EFF) if (t.indexOf(e) !== -1) return e;
    if (t.indexOf('white') !== -1 || t.indexOf('standard') !== -1) return 'white';
    return null;
  }

  // Collapse a form-factor string to a coarse class. SFX/SFX-L/TFX/Flex are all
  // "small"; everything else with ATX is "atx". Used as a hard constraint so an
  // SFX listing never matches an ATX entry (and vice versa).
  function formClass(s) {
    if (!s) return null;
    s = s.toLowerCase();
    if (/sfx|tfx|flex/.test(s)) return 'small';
    if (/atx/.test(s)) return 'atx';
    return null;
  }

  // Score one candidate token-set against the product token-set.
  //
  // Asymmetric, not plain Jaccard: tier-sheet model names carry descriptive
  // cruft the storefronts omit (e.g. "Series", odd qualifiers), so unmatched
  // *candidate* tokens are forgiven (weight `alpha`) while unmatched
  // *product* tokens - which suggest the product is something more specific -
  // are penalized at full weight (`beta`).
  function scoreTokens(productTokens, candTokens, generic, alpha, beta) {
    const pCounts = {};
    for (const t of productTokens) pCounts[t] = (pCounts[t] || 0) + 1;
    const candCounts = {};
    for (const t of candTokens) candCounts[t] = (candCounts[t] || 0) + 1;

    let interW = 0;
    let missC = 0;                 // candidate-only weight (soft-discounted)
    let distinctiveMatched = 0;
    for (const t in candCounts) {
      const w = tokenWeight(t, generic);
      const overlap = Math.min(candCounts[t], pCounts[t] || 0);
      if (overlap > 0) {
        interW += w * overlap;
        if (w >= 1) distinctiveMatched += overlap;
      }
      const missed = candCounts[t] - overlap;
      if (missed > 0) missC += (isSoftToken(t) ? w * 0.2 : w) * missed;
    }
    const prodW = weighted(productTokens, generic);
    const missP = prodW - interW;                           // product-only
    const denom = interW + alpha * missC + beta * missP;
    const score = denom > 0 ? interW / denom : 0;
    return {
      score,
      distinctiveMatched,
      coverageP: prodW > 0 ? interW / prodW : 0,             // share of product explained
      candHasDistinctive: candTokens.some((t) => tokenWeight(t, generic) >= 1)
    };
  }

  // ---- public match -------------------------------------------------------

  // `signals` is { wattage, efficiency, formFactor, modular } from the site
  // adapter. A bare number (or nothing) is accepted as just the wattage for
  // backwards compatibility and for plain-string test cases.
  function match(fullName, signals, index, rules) {
    rules = rules || index.rules || {};
    if (signals == null || typeof signals === 'number') signals = { wattage: signals || 0 };
    const generic = new Set(rules.generic || []);
    const noise = new Set(rules.noise || []);
    const thresholds = rules.thresholds || { strong: 0.75, likely: 0.45, floor: 0.45 };
    const alpha = rules.weights && rules.weights.candidateMiss != null ? rules.weights.candidateMiss : 0.35;
    const beta = rules.weights && rules.weights.productMiss != null ? rules.weights.productMiss : 0.2;
    const minCoverage = thresholds.minProductCoverage != null ? thresholds.minProductCoverage : 0.3;
    const constraintConf = rules.constraintConfidence != null ? rules.constraintConfidence : 0.55;

    const productWattage = signals.wattage || 0;
    // Prefer the structured efficiency column; fall back to parsing the name.
    const prodEff = efficiencyOf(signals.efficiency) || efficiencyOf(fullName);
    const prodForm = formClass(signals.formFactor);

    const aliased = stripDescriptors(applyRules(fullName, rules.aliases), rules);

    // Detect brand from the leading tokens, then keep the rest for scoring,
    // dropping the known wattage and noise words.
    const detected = detectBrand(tokenize(aliased), index.byBrand);
    if (!detected) return null;

    const candidates = index.byBrand[detected.key];
    const wattStr = productWattage ? String(productWattage) : null;
    const productTokens = detected.rest.filter((t) => !noise.has(t) && t !== wattStr);

    const scored = [];
    for (const entry of candidates) {
      if (!wattageOk(entry.wattage, productWattage)) continue;
      // Form factor is a hard constraint - it reliably disambiguates lines that
      // differ only by size (e.g. Lian Li SP is SFX, SX is ATX).
      const candForm = formClass(entry.form_factor);
      if (prodForm && candForm && prodForm !== candForm) continue;

      const candEff = efficiencyOf(entry.efficiency);

      // An entry can have several "/"-alias token sets; take its best.
      let local = { score: 0, distinctiveMatched: 0, coverageP: 0, candHasDistinctive: false };
      for (const candTokens of entry._tokens) {
        const r = scoreTokens(productTokens, candTokens, generic, alpha, beta);
        if (r.score > local.score) local = r;
      }

      let confidence = 0;

      // Path A - token match: a distinctive token in common (never match on
      // "gold" alone) explaining a meaningful share of the product name.
      const tokenEligible = !(local.candHasDistinctive && local.distinctiveMatched < 1)
        && local.coverageP >= minCoverage;
      if (tokenEligible) {
        confidence = local.score;
        if (prodEff && candEff && prodEff !== candEff) confidence *= 0.3; // soft efficiency penalty
      }

      // Path B - constraint match: when the name is too thin to score (e.g.
      // "NZXT C750" -> just "c"), fall back to the structured signals. Requires
      // every product token to appear in the candidate AND the efficiency to
      // *agree* (not merely not-conflict); wattage and form factor are already
      // gated above. This is what makes the structured columns pay off.
      if (confidence < thresholds.floor && prodEff && candEff && prodEff === candEff && productTokens.length) {
        const allIn = entry._tokens.some((ts) => {
          const set = new Set(ts);
          return productTokens.every((t) => set.has(t));
        });
        if (allIn) confidence = Math.max(confidence, constraintConf);
      }

      if (confidence < thresholds.floor) continue;
      scored.push({ entry, confidence: confidence, distinctive: local.distinctiveMatched });
    }

    if (!scored.length) return null;
    scored.sort((a, b) =>
      (b.confidence - a.confidence) || (b.distinctive - a.distinctive));
    const best = scored[0];

    if (best.confidence < thresholds.floor) return null;

    return {
      entry: best.entry,
      confidence: best.confidence,
      band: best.confidence >= thresholds.strong ? 'strong' : 'likely',
      alternates: scored.slice(1, 4)
        .filter((s) => s.confidence >= thresholds.floor * 0.7)
        .map((s) => ({ entry: s.entry, confidence: s.confidence })),
    };
  }

  const api = { buildIndex, match, tokenize, normKey, wattageOk, efficiencyOf };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    /** @type {any} */ (root).PSUMatcher = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
