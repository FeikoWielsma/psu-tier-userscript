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
 * (Jaccard). Wattage and comparable certification conflicts are hard gates.
 * Similarity is not a probability. Identity constraints run before scoring;
 * missing qualifiers and competing identities make a match uncertain.
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
    return applyRules(name, rules.strip).replace(/\b(?:atx|pcie)\s*\d+\.\d+\b/ig, ' ');
  }

  // Read identity evidence BEFORE descriptor stripping. Generation and revision
  // conflicts must never be forgiven by scoring or the constraint fallback.
  // Aliases are applied first so documented storefront/sheet naming mappings
  // (e.g. SF 2018 -> SF Platinum 2019) remain explicit in the rules.
  function qualifiersOf(name, wattage, rules, brandTokenCount = 0) {
    const out = { generation: [], year: [], revision: [], label: [], standard: [], variant: [] };
    let text = name.toLowerCase();
    const identity = rules.identity || {};
    for (const word of identity.revisionWords || []) {
      if (new RegExp('\\b' + word + '\\b').test(text)) out.revision.push(word);
    }
    for (const field of ['revision', 'variant']) {
      for (const rule of identity[field + 'Patterns'] || []) {
        const found = new RegExp(rule.pattern, 'i').exec(text);
        if (found) out[field].push(rule.value || found[rule.group || 0]);
      }
    }
    for (const word of identity.variantWords || []) {
      if (new RegExp('\\b' + word + '\\b').test(text)) out.variant.push(word);
    }
    text = text.replace(/\batx\s*(\d+\.\d+)\b/g, (_all, value) => {
      out.standard.push(value);
      return ' ';
    });
    text = text.replace(/\brev(?:ision)?\.?\s*(\d+(?:\.\d+)?)/g, (_all, value) => {
      out.revision.push(String(Number(value)));
      return ' ';
    });
    text = text.replace(/\b(gray|grey|black|green)\s+label\b/g, (_all, value) => {
      out.label.push(value === 'grey' ? 'gray' : value);
      return ' ';
    });
    text = text.replace(/\b(?:atx|pci[e-]*|gen)\s*\d+(?:\.\d+)?\b/g, ' ')
      .replace(/\b(?:80\s*\+?\s*(?:plus)?|230\s*v|115\s*v)\b/g, ' ');
    const roman = { i: '1', ii: '2', iii: '3', iv: '4', v: '5', vi: '6', vii: '7', viii: '8', ix: '9', x: '10' };
    for (const [position, token] of tokenize(text).entries()) {
      if (wattage && token === String(wattage)) continue;
      if (/^(19|20)\d\d$/.test(token)) out.year.push(token);
      else if (Object.hasOwn(roman, token) && (token.length > 1 || (position > brandTokenCount
        && new RegExp('(?:^|\\s)' + token + '(?:\\s|$)').test(text)))) out.generation.push(roman[token]);
      else if (/^[vx]\d{1,2}$/.test(token)) out.generation.push(token[0] === 'x' ? token : String(Number(token.slice(1))));
      else if (/^[1-9]\d?$/.test(token)) out.generation.push(String(Number(token)));
    }
    return out;
  }

  function identityKey(entry) {
    return JSON.stringify(['brand', 'model', 'wattage', 'year', 'form_factor',
      'efficiency', 'modularity', 'input_range', 'atx_version', 'tier', 'is_limited']
      .map((key) => entry[key] == null ? null : entry[key]));
  }

  function qualifierEvidence(product, candidate, entry) {
    let specified = false;
    let missing = false;
    let missingRevision = false;
    for (const key of Object.keys(product)) {
      const wanted = product[key];
      const available = candidate[key].length ? candidate[key]
        : key === 'year' && entry.year ? String(entry.year).match(/(?:19|20)\d\d/g) || [] : [];
      if (wanted.length) {
        if (key === 'standard' && !available.length) {
          const major = /(?:ATX\s*)?(\d+)\./i.exec(entry.atx_version || '');
          if (major && wanted.some((value) => !value.startsWith(major[1] + '.'))) return null;
          continue;
        }
        if (!wanted.every((value) => available.includes(value))) return null;
        if (key !== 'variant') specified = true;
      }
      // Named editions are distinct products, unlike an omitted generation.
      if (key === 'variant' && available.some((value) => !wanted.includes(value))) return null;
      if (candidate[key].length && !wanted.length) missing = true;
      if (key === 'revision' && candidate[key].length && !wanted.length) missingRevision = true;
    }
    // A year can identify a generation whose sheet name also spells out V2.
    return { uncertain: missingRevision || (missing && !specified) };
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
    rules = rules || {};
    const byBrand = Object.create(null); // brandKey -> [entry, ...]
    const noise = new Set((rules && rules.noise) || []);
    for (const entry of psuData) {
      // A model may carry "/"-separated aliases, e.g. "Pro / Pro RGB".
      const names = stripDescriptors(String(entry.model || entry.series || ''), rules)
        .split('/')
        .map((s) => s.trim())
        .filter(Boolean);
      const enriched = Object.assign({}, entry, {
        _identity: identityKey(entry),
        _allModels: /^all psus$/i.test(entry.model || ''),
        _recordKey: JSON.stringify(['source', 'odm', 'platform', 'topology', 'notes'].map((key) => entry[key] || null)),
        _qualifiers: qualifiersOf(String(entry.model || entry.series || ''), 0, rules),
        _tokens: names.map((s) => tokenize(s).filter((t) => !noise.has(t)))
      });
      const generic = new Set(rules.generic || []);
      enriched._families = names.map((name) => [...new Set(tokenize(name.replace(/\([^)]*\)/g, '')
        .replace(/\bsfx(?:[\s-]*l)?\b/ig, ''))
        .filter((t) => !noise.has(t) && !generic.has(t) && !isSoftToken(t) && !ROMAN_NUMERALS.test(t)
          && !/^\d+$/.test(t) && !((rules.identity || {}).familyNoise || []).includes(t)))].sort().join(' '));
      for (const k of brandKeys(entry.brand)) {
        (byBrand[k] || (byBrand[k] = [])).push(enriched);
      }
    }
    return { byBrand: byBrand, rules: rules };
  }

  // ---- scoring ------------------------------------------------------------

  const ROMAN_NUMERALS = /^(ii|iii|iv|vi|vii|viii)$/i;

  function tokenWeight(tok, generic) {
    if (generic.has(tok)) return 0.3;          // common marketing words
    if (/[0-9]/.test(tok)) return 2.0;         // model numbers / years
    if (ROMAN_NUMERALS.test(tok)) return 2.0;  // generation Roman numerals (II, III, IV)
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
    return /^(19|20)\d\d$/.test(t) || /^[vx]\d+$/.test(t) || /^\d+_\d+$/.test(t);
  }

  // A leftover product token that *names* the unit rather than describing it -
  // a word or code the storefront put in the title on purpose ("ELITE",
  // "SHIFT", "PCIE5", "II"). Bare numbers are excluded: wattages are stripped before
  // scoring and years/versions are already handled as soft tokens.
  function isNamingToken(t, generic) {
    return (t.length >= 1)
      && !generic.has(t) && !isSoftToken(t) && !/^\d+$/.test(t);
  }

  // Share of a token's weight awarded when it only matches as the head or tail
  // of a glued product token (see scoreTokens). Deliberately below 1: it is
  // strong evidence, but weaker than a clean token-for-token match.
  const GLUE_CREDIT = 0.6;

  function parseWattages(spec) {
    if (!spec) return null;
    const discrete = [];
    const ranges = [];
    for (const part of spec.toLowerCase().replace(/w/g, '').split('/')) {
      const range = /^\s*(\d+)\s*-\s*(\d+)\s*$/.exec(part);
      if (range) ranges.push([Number(range[1]), Number(range[2])]);
      else {
        const value = parseInt(part, 10);
        if (Number.isFinite(value)) discrete.push(value);
      }
    }
    return discrete.length || ranges.length ? { discrete, ranges } : null;
  }

  function wattageOk(spec, productWattage) {
    if (!spec || spec === 'All PSUs' || !productWattage) return true;
    const p = parseWattages(spec);
    if (!p) return true;
    return p.discrete.includes(productWattage)
      || p.ranges.some(([min, max]) => productWattage >= min && productWattage <= max);
  }

  const EFF = ['gold', 'bronze', 'silver', 'platinum', 'titanium'];
  function efficiencyOf(text) {
    const t = (text || '').toLowerCase();
    for (const e of EFF) if (t.indexOf(e) !== -1) return e;
    if (t.indexOf('standard') !== -1) return 'white';
    if (t.indexOf('white') !== -1) {
      if (t.length < 15 || /80\s*(plus|\+)\s*white/i.test(t)) return 'white';
    }
    if (/80\s*(?:plus|\+)(?!\s*(?:gold|bronze|silver|platinum|titanium))/i.test(t)) return 'white';
    return null;
  }

  // Keep explicitly reported grades as a set. A Cybenetics-only description
  // cannot establish an 80 PLUS grade; never invent a conversion between schemes.
  function efficienciesOf(text) {
    const t = (text || '').toLowerCase();
    if (/cybenetics/.test(t) && !/80\s*(?:plus|\+)/.test(t)) return new Set();
    const out = [];
    for (const e of EFF) if (t.indexOf(e) !== -1) out.push(e);
    if (!out.length) {
      const one = efficiencyOf(text);
      if (one) out.push(one);
    }
    return new Set(out);
  }

  // Retain distinct physical families. SFX/SFX-L compatibility is handled at
  // the match site because storefront categories sometimes group them together.
  function formClass(s) {
    if (!s) return null;
    s = s.toLowerCase();
    if (/sfx[\s-]*l/.test(s)) return 'sfx-l';
    if (/sfx/.test(s)) return 'sfx';
    if (/tfx/.test(s)) return 'tfx';
    if (/flex/.test(s)) return 'flex';
    if (/atx/.test(s)) return 'atx';
    return null;
  }

  // Normalize modularity string to 'full', 'semi', or 'no'.
  // Tolerates variants like "Full / Side" (PCPP) or "volledig modulair" (Tweakers).
  function normModularity(s) {
    if (!s) return null;
    s = s.toLowerCase();
    if (/semi/.test(s)) return 'semi';
    if (/full|volledig/.test(s)) return 'full';
    if (/no|non|niet/.test(s)) return 'no';
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
    const pCounts = Object.create(null);
    for (const t of productTokens) pCounts[t] = (pCounts[t] || 0) + 1;
    const candCounts = Object.create(null);
    for (const t of candTokens) candCounts[t] = (candCounts[t] || 0) + 1;

    const pUnmatched = Object.assign(Object.create(null), pCounts); // decremented as we explain them
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
      unexplainedNames: Object.keys(pUnmatched).filter((t) => pUnmatched[t] > 0 && !candCounts[t] && isNamingToken(t, generic)).length,
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
    const prodForm = formClass(signals.formFactor) || formClass(fullName);
    const prodMod = normModularity(signals.modular);

    const named = applyRules(fullName, rules.aliases);
    if (!prodEffs.size) prodEffs = efficienciesOf(named);
    const namedTokens = tokenize(named);
    const namedBrand = detectBrand(namedTokens, index.byBrand);
    if (!namedBrand) return null;
    const qualifiers = qualifiersOf(named, productWattage, rules, namedTokens.length - namedBrand.rest.length);
    const rawTokens = tokenize(fullName);
    const rawBrand = detectBrand(rawTokens, index.byBrand);
    const original = qualifiersOf(fullName, productWattage, rules, rawBrand ? rawTokens.length - rawBrand.rest.length : 0);
    // An alias can explain a year-to-generation mapping, but cannot silently
    // erase or rewrite an explicit conflicting generation supplied by a shop.
    if (original.generation.some((value) => !qualifiers.generation.includes(value))) return null;
    for (const key of ['revision', 'label', 'standard']) {
      qualifiers[key] = [...new Set([...original[key], ...qualifiers[key]])];
    }
    const aliased = stripDescriptors(named, rules);

    // Detect brand from the leading tokens, then keep the rest for scoring,
    // dropping the known wattage and noise words.
    const detected = detectBrand(tokenize(aliased), index.byBrand);
    if (!detected) return null;

    const candidates = index.byBrand[detected.key];
    const wattStr = productWattage ? String(productWattage) : null;
    const productTokens = detected.rest.filter((t) => !noise.has(t) && t !== wattStr);

    const scored = [];
    for (const entry of candidates) {
      const evidence = entry._allModels && productWattage > 0
        ? { uncertain: true } : qualifierEvidence(qualifiers, entry._qualifiers, entry);
      if (!evidence) continue;
      if (!wattageOk(entry.wattage, productWattage)) continue;
      // Form factor is a hard constraint - it reliably disambiguates lines that
      // differ only by size (e.g. Lian Li SP is SFX, SX is ATX).
      const candForm = formClass(entry.form_factor);
      // Storefronts and the sheet both sometimes use SFX as an umbrella for
      // SFX-L. It cannot establish a distinction they did not record reliably.
      if (prodForm && candForm && prodForm !== candForm
          && !([prodForm, candForm].every((form) => form === 'sfx' || form === 'sfx-l'))) continue;

      const candMod = normModularity(entry.modularity);
      if (prodMod && candMod && prodMod !== candMod) {
        if ((prodMod === 'full' && candMod === 'no') || (prodMod === 'no' && candMod === 'full')) {
          continue;
        }
      }

      const candEff = efficiencyOf(entry.efficiency);
      if (prodEffs.size && candEff && !prodEffs.has(candEff)) continue;

      // An entry can have several "/"-alias token sets; take its best.
      let local = { score: 0, distinctiveMatched: 0, coverageP: 0, candHasDistinctive: false, unexplainedNames: 0 };
      for (const candTokens of entry._tokens) {
        const r = scoreTokens(productTokens, candTokens, generic, alpha, beta, betaNamed);
        if (!r.unexplainedNames && r.score > local.score) local = r;
      }

      let confidence = 0;
      if (entry._allModels && productWattage > 0) confidence = constraintConf;

      // Path A - token match: a distinctive token in common (never match on
      // "gold" alone) explaining a meaningful share of the product name.
      const tokenEligible = local.distinctiveMatched >= 1 && local.coverageP >= minCoverage;
      if (tokenEligible) {
        confidence = Math.max(confidence, local.score);
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
      scored.push({ entry, confidence: confidence, distinctive: local.distinctiveMatched, uncertain: evidence.uncertain });
    }

    if (!scored.length) return null;
    scored.sort((a, b) =>
      (b.confidence - a.confidence) ||
      ((a.entry.is_limited ? 1 : 0) - (b.entry.is_limited ? 1 : 0)) ||
      (b.distinctive - a.distinctive) ||
      (a.entry._identity < b.entry._identity ? -1 : a.entry._identity > b.entry._identity ? 1 : 0) ||
      (a.entry._recordKey < b.entry._recordKey ? -1 : a.entry._recordKey > b.entry._recordKey ? 1 : 0));
    const unique = scored.filter((s, i) => scored.findIndex((other) => other.entry._identity === s.entry._identity) === i);
    const best = unique[0];

    if (best.confidence < thresholds.floor) return null;

    // A near-tie against a candidate on a *different* tier means the sort order,
    // not the evidence, chose the badge - e.g. "PS X GFM" exists twice at the
    // same wattage on tiers C and B-. Report those as a likely match so the UI
    // marks them uncertain and shows the rival in the alternates list, rather
    // than stating one tier as settled.
    const gap = thresholds.ambiguousGap != null ? thresholds.ambiguousGap : 0.02;
    const rivals = unique.filter((s) => s !== best && (best.confidence - s.confidence <= gap
      || ((s.uncertain || best.uncertain || (s.entry.year !== best.entry.year
        && !qualifiers.year.length && !qualifiers.generation.length))
        && s.entry._families.some((family) => family && best.entry._families.includes(family)))));
    const contested = rivals.some((s) => s.entry.tier !== best.entry.tier);
    const ambiguous = best.uncertain || rivals.length > 0;

    return {
      entry: best.entry,
      confidence: best.confidence,
      band: !ambiguous && best.confidence >= thresholds.strong ? 'strong' : 'likely',
      ambiguous: ambiguous,
      contested: contested,
      alternates: unique.slice(1)
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
