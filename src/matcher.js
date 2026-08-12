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
  //
  // A dotted version number is also split off its prefix, so the unspaced
  // "ATX3.0" tokenizes the same way the sheet's "ATX 3.0" does - otherwise one
  // side yields the throwaway "atx" plus a soft "3_0" and the other yields a
  // single "atx3_0" that reads like a model name.
  function tokenize(s) {
    return (s || '')
      .toLowerCase()
      .replace(/(\d)\.(\d)/g, '$1_$2')
      .replace(/[^a-z0-9_]+/g, ' ')
      .replace(/([a-z])([0-9]{3,})/g, '$1 $2')
      .replace(/([0-9]{3,})([a-z])/g, '$1 $2')
      .replace(/([a-z])(\d+_\d)/g, '$1 $2')
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
    const noise = new Set((rules && rules.noise) || []);
    for (const entry of psuData) {
      // A model may carry "/"-separated aliases, e.g. "Pro / Pro RGB".
      const names = stripDescriptors(String(entry.model || entry.series || ''), rules)
        .split('/')
        .map((s) => s.trim())
        .filter(Boolean);
      const enriched = Object.assign({}, entry, {
        _tokens: names.map((s) => tokenize(s).filter((t) => !noise.has(t)))
      });
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
    return /^(19|20)\d\d$/.test(t) || /^v\d+$/.test(t) || /^\d+_\d+$/.test(t);
  }

  // A leftover product token that *names* the unit rather than describing it -
  // a word or code the storefront put in the title on purpose ("ELITE",
  // "SHIFT", "PCIE5"). Bare numbers are excluded: wattages are stripped before
  // scoring and years/versions are already handled as soft tokens.
  function isNamingToken(t, generic) {
    return t.length >= 3 && !generic.has(t) && !isSoftToken(t) && !/^\d+$/.test(t);
  }

  // Share of a token's weight awarded when it only matches as the head or tail
  // of a glued product token (see scoreTokens). Deliberately below 1: it is
  // strong evidence, but weaker than a clean token-for-token match.
  const GLUE_CREDIT = 0.6;

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
  // Efficiency grades in ascending order, used to relate the two certification
  // schemes to each other (see efficienciesOf).
  const EFF_LADDER = ['white', 'bronze', 'silver', 'gold', 'platinum', 'titanium'];
  function efficiencyOf(text) {
    const t = (text || '').toLowerCase();
    for (const e of EFF) if (t.indexOf(e) !== -1) return e;
    if (t.indexOf('standard') !== -1) return 'white';
    if (t.indexOf('white') !== -1) {
      if (t.length < 15 || /80\s*(plus|\+)\s*white/i.test(t)) return 'white';
    }
    return null;
  }

  // A storefront can report more than one certification level for one unit:
  // Tweakers shows the 80 PLUS and Cybenetics ETA grades in a single cell
  // ("Gold, Platinum"), and the two schemes disagree by design - Cybenetics
  // tests at 230V on a stricter curve, so an 80+ Gold unit is often ETA
  // Platinum. Collapsing that to one level would penalize the correct entry, so
  // treat it as a set of acceptable levels instead: a candidate conflicts only
  // when it matches none of them.
  function efficienciesOf(text) {
    const t = (text || '').toLowerCase();
    const out = [];
    for (const e of EFF) if (t.indexOf(e) !== -1) out.push(e);
    if (!out.length) {
      const one = efficiencyOf(text);
      if (one) out.push(one);
    }
    const set = new Set(out);

    // Cybenetics grades on a stricter 230V curve than 80 PLUS, so a unit's ETA
    // grade is usually equal to - or one step above - its 80 PLUS grade
    // (Corsair's RM1000x is 80+ Gold but ETA Platinum). When a grade is
    // attributed to Cybenetics, accept the step below it as well, or the sheet's
    // correct entry gets penalized for a rating it never claimed.
    const cyb = /cybenetics[^a-z]*(?:eta|lambda)?[^a-z]*([a-z]+)/i.exec(t);
    if (cyb) {
      const i = EFF_LADDER.indexOf(cyb[1]);
      if (i > 0) set.add(EFF_LADDER[i - 1]);
    }
    return set;
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
  // are penalized at `beta`, or at the steeper `betaNamed` when the token is
  // one that names the model (see isNamingToken).
  function scoreTokens(productTokens, candTokens, generic, alpha, beta, betaNamed) {
    const pCounts = {};
    for (const t of productTokens) pCounts[t] = (pCounts[t] || 0) + 1;
    const candCounts = {};
    for (const t of candTokens) candCounts[t] = (candCounts[t] || 0) + 1;

    const pUnmatched = Object.assign({}, pCounts);   // decremented as we explain them
    let interW = 0;
    let missC = 0;                 // candidate-only weight (soft-discounted)
    let distinctiveMatched = 0;
    const unexplained = [];        // candidate tokens with no exact counterpart
    for (const t in candCounts) {
      const w = tokenWeight(t, generic);
      const overlap = Math.min(candCounts[t], pCounts[t] || 0);
      if (overlap > 0) {
        interW += w * overlap;
        pUnmatched[t] -= overlap;
        if (w >= 0.5 && !isSoftToken(t) && !generic.has(t)) distinctiveMatched += overlap;
      }
      const missed = candCounts[t] - overlap;
      if (missed > 0) {
        missC += (isSoftToken(t) ? w * 0.2 : w) * missed;
        unexplained.push(t);
      }
    }

    // Glued model codes. Storefronts run codes together that the sheet spaces
    // out - "TR-SGFX" for "TR-SG FX", "RMx" for "RM-x", "PSX" for "PS X". When
    // two unexplained candidate tokens spell an unexplained product token
    // exactly, head-to-tail, they are that same code written without the space,
    // so credit them instead of scoring both as misses. Without this, "TR-SG FX"
    // and "TR-TG FX" score identically against "TR-SGFX" and the tie is broken
    // arbitrarily - across two different tiers.
    //
    // The whole token must be accounted for. A bare prefix is NOT enough: MSI's
    // "A-BN" and "A-BNL" are different units, so letting "bn" claim "bnl" would
    // hand the wrong one a near-perfect score.
    const leftover = Object.keys(pCounts).filter((t) => !candCounts[t] && t.length >= 3);
    const spent = new Set();       // each candidate token can be glued only once
    for (const p of leftover) {
      let head = null;
      let tail = null;
      for (const c of unexplained) {
        if (spent.has(c) || c.length < 1 || c.length >= p.length) continue;
        if (generic.has(c) || isSoftToken(c)) continue;
        if (!head && p.indexOf(c) === 0) head = c;
        else if (!tail && p.lastIndexOf(c) === p.length - c.length) tail = c;
      }
      if (!head || !tail || head.length + tail.length !== p.length) continue;
      pUnmatched[p] -= 1;          // the product token is now fully accounted for
      for (const c of [head, tail]) {
        spent.add(c);
        const credit = tokenWeight(c, generic) * GLUE_CREDIT;
        interW += credit;
        missC -= credit;
        distinctiveMatched += 1;
      }
    }

    // Product-side misses, split by how much the leftover token identifies the
    // unit. A candidate that ignores "ELITE" is a worse answer than one that
    // ignores a stray descriptor, and charging both at `beta` let short sheet
    // names win on a single shared letter: "Aorus P-W AP-GM" beat "Aorus Elite
    // AE-PM PG5" for "AORUS ELITE P850" on nothing but the "P".
    let missP = 0;
    let missPNamed = 0;
    for (const t in pUnmatched) {
      const n = pUnmatched[t];
      if (n <= 0) continue;
      const w = tokenWeight(t, generic) * n;
      if (isNamingToken(t, generic)) missPNamed += w;
      else missP += w;
    }

    const prodW = weighted(productTokens, generic);
    const denom = interW + alpha * missC + beta * missP + betaNamed * missPNamed;
    const score = denom > 0 ? Math.min(1, interW / denom) : 0;
    return {
      score,
      distinctiveMatched,
      coverageP: prodW > 0 ? Math.min(1, interW / prodW) : 0, // share of product explained
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
    const betaNamed = rules.weights && rules.weights.productMissNamed != null
      ? rules.weights.productMissNamed : beta;
    const minCoverage = thresholds.minProductCoverage != null ? thresholds.minProductCoverage : 0.3;
    const constraintConf = rules.constraintConfidence != null ? rules.constraintConfidence : 0.55;

    const productWattage = signals.wattage || 0;
    // Prefer the structured efficiency column; fall back to parsing the name.
    // `efficiencyNote` is the storefront's prose spec line, which is what names
    // the certification scheme; the clean column alone doesn't say whether a
    // lone "Platinum" is 80 PLUS or Cybenetics.
    let prodEffs = efficienciesOf([signals.efficiency, signals.efficiencyNote].filter(Boolean).join(' '));
    if (!prodEffs.size) prodEffs = efficienciesOf(fullName);
    const prodForm = formClass(signals.formFactor);
    const prodMod = signals.modular;

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

      const candMod = entry.modularity;
      if (prodMod && candMod && prodMod !== candMod) {
        if ((prodMod === 'Full' && candMod === 'No') || (prodMod === 'No' && candMod === 'Full')) {
          continue;
        }
      }

      const candEff = efficiencyOf(entry.efficiency);

      // An entry can have several "/"-alias token sets; take its best.
      let local = { score: 0, distinctiveMatched: 0, coverageP: 0, candHasDistinctive: false };
      for (const candTokens of entry._tokens) {
        const r = scoreTokens(productTokens, candTokens, generic, alpha, beta, betaNamed);
        if (r.score > local.score) local = r;
      }

      let confidence = 0;

      // Path A - token match: a distinctive token in common (never match on
      // "gold" alone) explaining a meaningful share of the product name.
      const tokenEligible = !(local.candHasDistinctive && local.distinctiveMatched < 1)
        && local.coverageP >= minCoverage;
      if (tokenEligible) {
        confidence = local.score;
        // Soft efficiency penalty - only when the candidate matches none of the
        // levels the storefront reported for this unit.
        if (prodEffs.size && candEff && !prodEffs.has(candEff)) confidence *= 0.5;
      }

      // Path B - constraint match: when the name is too thin to score (e.g.
      // "NZXT C750" -> just "c"), fall back to the structured signals. Requires
      // every product token to appear in the candidate AND the efficiency to
      // *agree* (not merely not-conflict); wattage and form factor are already
      // gated above. This is what makes the structured columns pay off.
      if (confidence < thresholds.floor && prodEffs.has(candEff) && productTokens.length) {
        const effWords = new Set(['gold', 'bronze', 'silver', 'platinum', 'titanium', 'white', 'standard']);
        const nameTokens = productTokens.filter((t) => !effWords.has(t));
        if (nameTokens.length) {
          const allIn = entry._tokens.some((ts) => {
            const set = new Set(ts);
            return nameTokens.every((t) => set.has(t));
          });
          if (allIn) confidence = Math.max(confidence, constraintConf);
        }
      }

      if (prodMod && candMod && prodMod !== candMod) {
        confidence *= 0.7; // soft modularity penalty for Semi-modular conflicts
      }

      if (confidence < thresholds.floor) continue;
      scored.push({ entry, confidence: confidence, distinctive: local.distinctiveMatched });
    }

    if (!scored.length) return null;
    scored.sort((a, b) =>
      (b.confidence - a.confidence) ||
      ((a.entry.is_limited ? 1 : 0) - (b.entry.is_limited ? 1 : 0)) ||
      (b.distinctive - a.distinctive));
    const best = scored[0];

    if (best.confidence < thresholds.floor) return null;

    // A near-tie against a candidate on a *different* tier means the sort order,
    // not the evidence, chose the badge - e.g. "PS X GFM" exists twice at the
    // same wattage on tiers C and B-. Report those as a likely match so the UI
    // marks them uncertain and shows the rival in the alternates list, rather
    // than stating one tier as settled.
    const gap = thresholds.ambiguousGap != null ? thresholds.ambiguousGap : 0.02;
    const contested = scored.some((s) => s !== best
      && s.entry.tier !== best.entry.tier
      && best.confidence - s.confidence <= gap);

    return {
      entry: best.entry,
      confidence: best.confidence,
      band: !contested && best.confidence >= thresholds.strong ? 'strong' : 'likely',
      contested: contested,
      alternates: scored.slice(1, 4)
        .filter((s) => s.confidence >= thresholds.floor * 0.7)
        .map((s) => ({ entry: s.entry, confidence: s.confidence })),
    };
  }

  const api = { buildIndex, match, tokenize, normKey, wattageOk, efficiencyOf, efficienciesOf };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    /** @type {any} */ (root).PSUMatcher = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
