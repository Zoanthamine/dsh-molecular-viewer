/* Molecular coordinate parsers. No dependencies, IO, code execution or embedding. */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MoleculeParsers = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  var SYMBOLS = ('H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og').split(' ');
  var ELEMENTS = new Set(SYMBOLS);
  var BOHR = 0.529177210903;
  var DEFAULT_LIMITS = Object.freeze({ maxBytes: 33554432, maxAtoms: 100000, maxFrames: 1000, maxTotalAtoms: 1000000, maxCoordinateAbs: 1000000 });
  var HARD_LIMITS = { maxBytes: 134217728, maxAtoms: 200000, maxFrames: 5000, maxTotalAtoms: 5000000, maxCoordinateAbs: 1000000000 };
  var NUM = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eEdD][+-]?\d+)?$/;
  function ParseError(message, code, line, format) {
    this.name = 'MoleculeParseError'; this.message = message + (line ? ' (line ' + line + ')' : '');
    this.code = code || 'MALFORMED_DATA';
    if (line) this.line = line;
    if (format) this.format = format;
    if (Error.captureStackTrace) Error.captureStackTrace(this, ParseError);
  }
  ParseError.prototype = Object.create(Error.prototype); ParseError.prototype.constructor = ParseError;
  function fail(message, line, code) { throw new ParseError(message, code, line); }
  function number(s, line, description) {
    if (typeof s !== 'string' || !NUM.test(s.trim())) fail('Invalid ' + (description || 'number') + ': ' + String(s).slice(0, 40), line);
    var n = Number(s.trim().replace(/[dD]/, 'e'));
    if (!Number.isFinite(n)) fail('Non-finite ' + (description || 'number'), line);
    return n;
  }
  function integer(s, line, description) {
    if (!/^[+-]?\d+$/.test(String(s).trim())) fail('Invalid ' + (description || 'integer'), line);
    var n = Number(s);
    if (!Number.isSafeInteger(n)) fail('Unsafe ' + (description || 'integer'), line);
    return n;
  }
  function element(s, line) {
    s = String(s).trim();
    if (/^\d+$/.test(s)) {
      var z = integer(s, line, 'atomic number');
      if (z < 1 || z > SYMBOLS.length) fail('Unsupported atomic number (ghost/dummy centers are not atoms): ' + z, line);
      return SYMBOLS[z - 1];
    }
    if (!/^[A-Za-z]{1,2}$/.test(s)) fail('Invalid element symbol: ' + s.slice(0, 20), line);
    var e = s[0].toUpperCase() + s.slice(1).toLowerCase();
    if (!ELEMENTS.has(e)) fail('Unknown element: ' + s, line);
    return e;
  }
  function atom(el, coords, line, ctx, scale, extra) {
    var a = Object.assign({ element: element(el, line) }, extra || {});
    ['x', 'y', 'z'].forEach(function (axis, i) {
      var value = number(coords[i], line, axis + ' coordinate') * (scale || 1);
      if (!Number.isFinite(value) || Math.abs(value) > ctx.limits.maxCoordinateAbs) fail('Coordinate outside allowed range', line, 'LIMIT_EXCEEDED');
      a[axis] = value;
    });
    return a;
  }
  function warn(ctx, message) { if (!ctx.warnings.includes(message)) ctx.warnings.push(message); }
  function countAtoms(n, ctx, line) {
    if (n < 1) fail('Empty molecular frame is not supported', line);
    if (n > ctx.limits.maxAtoms) fail('Per-frame atom limit exceeded', line, 'LIMIT_EXCEEDED');
  }
  function frame(ctx, name, atoms, bonds, metadata) {
    countAtoms(atoms.length, ctx, metadata.lineStart);
    if (ctx.frames.length >= ctx.limits.maxFrames) fail('Frame limit exceeded', metadata.lineStart, 'LIMIT_EXCEEDED');
    ctx.total += atoms.length;
    if (ctx.total > ctx.limits.maxTotalAtoms) fail('Total atom limit exceeded', metadata.lineStart, 'LIMIT_EXCEEDED');
    var out = { name: String(name || 'Frame ' + (ctx.frames.length + 1)), atoms: atoms, bonds: bonds || [], metadata: Object.assign({ units: 'angstrom', atomIndices: '0-based' }, metadata) };
    ctx.frames.push(out); return out;
  }
  function parseXYZ(lines, ctx) {
    var i = 0;
    while (i < lines.length) {
      while (i < lines.length && !lines[i].trim()) i++;
      if (i === lines.length) break;
      var start = i + 1, n = integer(lines[i++].trim(), start, 'XYZ atom count'); countAtoms(n, ctx, start);
      if (i >= lines.length) fail('XYZ comment line missing', i + 1);
      var name = lines[i++];
      if (i + n > lines.length) fail('Truncated XYZ frame', start);
      var atoms = [];
      for (var a = 0; a < n; a++, i++) {
        var t = lines[i].trim().split(/\s+/);
        if (t.length < 4) fail('XYZ atom requires element and three coordinates', i + 1);
        atoms.push(atom(t[0], t.slice(1, 4), i + 1, ctx));
        if (t.length > 4) warn(ctx, 'Extra XYZ columns are ignored; extended-XYZ properties are not interpreted.');
      }
      frame(ctx, name, atoms, [], { lineStart: start, sourceUnits: 'angstrom', coordinateProvenance: 'supplied coordinates', connectivity: 'not supplied' });
    }
    warn(ctx, 'XYZ does not encode bond orders; any renderer-inferred connectivity is display-only.');
  }
  function parseMolRecord(lines, ctx, offset) {
    if (lines.length < 4) fail('MOL/SDF record needs three header lines and a counts line', offset + 1);
    var counts = lines[3];
    if (/V3000/.test(counts) || lines.some(function (l) { return /^M\s+V30\b/.test(l); })) fail('MOL V3000 is not supported; export V2000 or XYZ', offset + 4, 'UNSUPPORTED_FORMAT');
    if (!/V2000\s*$/.test(counts)) fail('Only explicit MOL V2000 counts lines are supported', offset + 4, 'UNSUPPORTED_FORMAT');
    var n = integer(counts.slice(0, 3), offset + 4, 'atom count'), nb = integer(counts.slice(3, 6), offset + 4, 'bond count');
    countAtoms(n, ctx, offset + 4);
    if (nb < 0 || nb > n * 12) fail('Invalid/excessive bond count', offset + 4, 'LIMIT_EXCEEDED');
    if (lines.length < 4 + n + nb) fail('Truncated V2000 atom/bond table', offset + 4);
    var atoms = [], bonds = [], seen = new Set(), chargeMap = { 1: 3, 2: 2, 3: 1, 5: -1, 6: -2, 7: -3 };
    for (var a = 0; a < n; a++) {
      var s = lines[4 + a], ln = offset + 5 + a;
      if (s.length < 34) fail('Truncated fixed-width V2000 atom row', ln);
      var at = atom(s.slice(31, 34), [s.slice(0, 10), s.slice(10, 20), s.slice(20, 30)], ln, ctx);
      var cc = s.slice(36, 39).trim();
      if (cc) {
        cc = integer(cc, ln, 'MDL charge code');
        if (cc < 0 || cc > 7) fail('Invalid MDL charge code', ln);
        if (chargeMap[cc]) at.charge = chargeMap[cc];
        if (cc === 4) at.radicalCode = 2;
      }
      atoms.push(at);
    }
    for (var b = 0; b < nb; b++) {
      var bl = lines[4 + n + b], bn = offset + 5 + n + b;
      var from = integer(bl.slice(0, 3), bn, 'bond atom') - 1, to = integer(bl.slice(3, 6), bn, 'bond atom') - 1, order = integer(bl.slice(6, 9), bn, 'bond order');
      if (from < 0 || to < 0 || from >= n || to >= n || from === to) fail('Invalid bond atom index', bn);
      if (order < 1 || order > 4) fail('Query/unsupported bond order: ' + order, bn, 'UNSUPPORTED_FORMAT');
      var key = Math.min(from, to) + ':' + Math.max(from, to);
      if (seen.has(key)) fail('Duplicate V2000 bond', bn); seen.add(key);
      var bond = { from: from, to: to, order: order };
      if (bl.slice(9, 12).trim()) bond.stereo = integer(bl.slice(9, 12), bn, 'bond stereo flag');
      bonds.push(bond);
    }
    var end = -1;
    for (var j = 4 + n + nb; j < lines.length; j++) {
      if (/^M\s+END\s*$/.test(lines[j])) { end = j; break; }
      if (/^M\s+(CHG|ISO|RAD)\b/.test(lines[j])) {
        var t = lines[j].trim().split(/\s+/), entries = integer(t[2], offset + j + 1, 'MDL property count');
        if (entries < 0 || entries > n || t.length !== 3 + 2 * entries) fail('Malformed MDL property list', offset + j + 1);
        for (var p = 0; p < entries; p++) {
          var ai = integer(t[3 + p * 2], offset + j + 1, 'property atom') - 1, v = integer(t[4 + p * 2], offset + j + 1, 'property value');
          if (ai < 0 || ai >= n) fail('MDL property atom out of range', offset + j + 1);
          if (t[1] === 'ISO' && v < 1) fail('Invalid isotope mass', offset + j + 1);
          if (t[1] === 'RAD' && (v < 1 || v > 3)) fail('Invalid radical code', offset + j + 1);
          atoms[ai][{ CHG: 'charge', ISO: 'isotope', RAD: 'radicalCode' }[t[1]]] = v;
        }
      } else if (lines[j].trim()) warn(ctx, 'Some MDL auxiliary/query records were not interpreted; this is a coordinate viewer, not a chemical-identity validator.');
    }
    if (end < 0) fail('M END terminator missing', offset + lines.length);
    var properties = Object.create(null);
    for (var k = end + 1; k < lines.length; k++) {
      if (!lines[k].trim()) continue;
      var m = /^>\s*<([^>]+)>/.exec(lines[k]);
      if (!m) { warn(ctx, 'Unrecognized text after M END was ignored.'); continue; }
      if (m[1].length > 256) fail('SDF property name too long', offset + k + 1, 'LIMIT_EXCEEDED');
      var vals = [];
      while (k + 1 < lines.length && lines[k + 1].trim() && !/^>\s*</.test(lines[k + 1])) vals.push(lines[++k]);
      if (Object.prototype.hasOwnProperty.call(properties, m[1])) warn(ctx, 'Duplicate SDF property name; only the last value is retained.');
      properties[m[1]] = vals.join('\n');
    }
    var planar = atoms.every(function (at) { return Math.abs(at.z) <= 1e-6; });
    if (planar) warn(ctx, 'Planar coordinates may be 2D; a genuinely planar molecule can also have these coordinates. No 3D generation was performed.');
    frame(ctx, lines[0], atoms, bonds, { lineStart: offset + 1, sourceUnits: 'angstrom', coordinateProvenance: 'supplied coordinates', planarCoordinates: planar, properties: properties, connectivity: 'explicit V2000 bonds' });
  }
  function parseSDF(lines, ctx, format) {
    var start = 0, records = 0;
    for (var i = 0; i <= lines.length; i++) {
      if (i < lines.length && lines[i].trim() !== '$$$$') continue;
      var chunk = lines.slice(start, i);
      if (chunk.every(function (s) { return !s.trim(); })) {
        if (i !== lines.length) fail('Empty SDF record', start + 1);
      } else {
        if (format === 'mol' && records > 0) fail('Multiple records require SDF format', start + 1);
        parseMolRecord(chunk, ctx, start); records++;
      }
      start = i + 1;
    }
  }
  function pdbElement(name, field, line, ctx) {
    if (field.trim()) return element(field, line);
    warn(ctx, 'PDB element column missing: elements inferred from fixed-width atom names; verify ambiguous/unusual names.');
    if (/^\s/.test(name) || /^\d/.test(name)) {
      var one = name.replace(/^[\s\d]+/, '').match(/^[A-Za-z]/);
      if (!one) fail('Cannot infer PDB element', line); return element(one[0], line);
    }
    var letters = name.match(/^[A-Za-z]{1,2}/);
    if (!letters) fail('Cannot infer PDB element', line);
    var two = letters[0][0].toUpperCase() + letters[0].slice(1).toLowerCase();
    return ELEMENTS.has(two) ? two : element(letters[0][0], line);
  }
  function parsePDB(lines, ctx) {
    var blocks = [], current = null, implicit = [], explicit = false, conect = [], serials = new Set();
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i], record = line.slice(0, 6).trim();
      if (record === 'MODEL') {
        if (current || implicit.length) fail('Nested MODEL or atoms outside MODEL blocks', i + 1);
        explicit = true;
        current = { atoms: [], conect: [], modelId: integer(line.slice(10, 14).trim(), i + 1, 'MODEL ID'), lineStart: i + 1 }; serials = new Set();
      } else if (record === 'ENDMDL') {
        if (!current) fail('ENDMDL without MODEL', i + 1);
        blocks.push(current); current = null;
        if (blocks.length > ctx.limits.maxFrames) fail('Frame limit exceeded', i + 1, 'LIMIT_EXCEEDED');
      } else if (record === 'ATOM' || record === 'HETATM') {
        if (explicit && !current) fail('Atom outside explicit MODEL block', i + 1);
        var serial = integer(line.slice(6, 11), i + 1, 'PDB atom serial');
        if (serial < 1 || serials.has(serial)) fail('Invalid/duplicate PDB atom serial (hybrid-36 is not supported)', i + 1);
        serials.add(serial);
        var name = line.slice(12, 16), occupancy = line.slice(54, 60).trim();
        occupancy = occupancy ? number(occupancy, i + 1, 'occupancy') : 1;
        if (occupancy < 0 || occupancy > 1) fail('PDB occupancy must be in [0,1]', i + 1);
        var extra = { serial: serial, atomName: name.trim(), altLoc: line.slice(16, 17).trim(), residueName: line.slice(17, 20).trim(), chain: line.slice(21, 22).trim(), residueId: line.slice(22, 26).trim(), insertionCode: line.slice(26, 27).trim(), occupancy: occupancy };
        if (line.slice(60, 66).trim()) extra.bFactor = number(line.slice(60, 66), i + 1, 'B factor');
        if (line.slice(78, 80).trim()) {
          var charge = /^(\d)([+-])$/.exec(line.slice(78, 80).trim());
          if (!charge) fail('Invalid PDB charge field', i + 1);
          extra.charge = Number(charge[1]) * (charge[2] === '+' ? 1 : -1);
        }
        var pa = atom(pdbElement(name, line.slice(76, 78), i + 1, ctx), [line.slice(30, 38), line.slice(38, 46), line.slice(46, 54)], i + 1, ctx, 1, extra);
        (current ? current.atoms : implicit).push(pa);
        if ((current ? current.atoms.length : implicit.length) > ctx.limits.maxAtoms) fail('PDB raw atom limit exceeded', i + 1, 'LIMIT_EXCEEDED');
      } else if (record === 'CONECT') {
        var ids = [];
        for (var c = 6; c < Math.min(line.length, 31); c += 5) {
          if (line.slice(c, c + 5).trim()) ids.push(integer(line.slice(c, c + 5), i + 1, 'CONECT serial'));
        }
        if (!ids.length || ids.some(function (s) { return s < 1; })) fail('Invalid CONECT record', i + 1);
        (current ? current.conect : conect).push(ids);
      } else if (record === 'END' && current) fail('MODEL missing ENDMDL before END', i + 1);
    }
    if (current) fail('Truncated MODEL: ENDMDL missing', current.lineStart);
    if (!explicit) blocks.push({ atoms: implicit, lineStart: 1 });
    blocks.forEach(function (block, bi) {
      var alternatives = new Map(), alternateAtomKeys = new Set();
      function residueKey(a) { return [a.chain, a.residueId, a.insertionCode].join('|'); }
      block.atoms.forEach(function (a) {
        var key = residueKey(a);
        if (!alternatives.has(key)) alternatives.set(key, new Set());
        if (a.altLoc) {
          alternatives.get(key).add(a.altLoc);
          alternateAtomKeys.add(key + '|' + a.atomName);
        }
      });
      var choices = new Map(), hasAlt = false;
      alternatives.forEach(function (alts, key) { var labels = Array.from(alts).sort(); if (labels.length) { hasAlt = true; choices.set(key, alts.has('A') ? 'A' : labels[0]); } });
      if (hasAlt) warn(ctx, 'PDB alternate locations: retain shared blank atoms and one consistent label per residue (A preferred, otherwise lexically first); occupancy is not a conformer weight.');
      var chosen = new Map();
      block.atoms.forEach(function (a) {
        var key = residueKey(a);
        if (a.altLoc && a.altLoc !== choices.get(key)) return;
        var atomKey = key + '|' + a.atomName;
        // Repeated blank-altloc names can be distinct Chem3D atoms: serial is their identity.
        // Name-based deduplication is valid only at a site with explicit alternate locations.
        if (!alternateAtomKeys.has(atomKey)) atomKey = 'serial:' + a.serial;
        if (!chosen.has(atomKey)) chosen.set(atomKey, a);
        else if (!a.altLoc && chosen.get(atomKey).altLoc) chosen.set(atomKey, a);
        else warn(ctx, 'PDB duplicate atom names after altloc selection: shared blank atom or first occurrence retained.');
      });
      var atoms = Array.from(chosen.values()), serialMap = new Map(), bondMap = new Map();
      atoms.forEach(function (a, n) { serialMap.set(a.serial, n); });
      var modelConect = conect.concat(block.conect || []);
      modelConect.forEach(function (ids) {
        var counts = new Map(); ids.slice(1).forEach(function (s) { counts.set(s, (counts.get(s) || 0) + 1); });
        counts.forEach(function (order, target) {
          if (!serialMap.has(ids[0]) || !serialMap.has(target)) { warn(ctx, 'CONECT references unavailable/alternate atoms in a model; those connections were omitted.'); return; }
          var from = serialMap.get(ids[0]), to = serialMap.get(target);
          if (from === to) fail('Self-bond in CONECT');
          var key = Math.min(from, to) + ':' + Math.max(from, to);
          bondMap.set(key, { from: Math.min(from, to), to: Math.max(from, to), order: Math.max(Math.min(order, 3), bondMap.has(key) ? bondMap.get(key).order : 1) });
        });
      });
      frame(ctx, 'Model ' + (block.modelId === undefined ? bi + 1 : block.modelId), atoms, Array.from(bondMap.values()), { lineStart: block.lineStart, modelId: block.modelId, sourceUnits: 'angstrom', altlocSelection: 'blank plus A-preferred consistent residue label', connectivity: modelConect.length ? 'explicit CONECT, missing endpoints omitted' : 'not supplied', coordinateProvenance: 'supplied coordinates' });
    });
    warn(ctx, 'PDB atom connectivity/chemical identity is not validated; coordinate models are not optimized structures.');
  }
  function parseGaussianInput(lines, ctx) {
    if (lines.some(function (l) { return /^\s*--Link1--/i.test(l); })) fail('Multi-job Gaussian Link1 input is not supported; split the jobs', undefined, 'UNSUPPORTED_FORMAT');
    var i = lines.findIndex(function (l) { return /^\s*#/.test(l); });
    if (i < 0) fail('Gaussian route section missing');
    var route = [], title = [];
    while (i < lines.length && lines[i].trim()) route.push(lines[i++]);
    if (i >= lines.length) fail('Gaussian route/title separators missing'); i++;
    while (i < lines.length && lines[i].trim()) title.push(lines[i++]);
    if (!title.length || i >= lines.length) fail('Gaussian title/charge separator missing', i + 1); i++;
    while (i < lines.length && !lines[i].trim()) i++;
    var cm = lines[i] && lines[i].trim().split(/\s+/);
    if (!cm || cm.length < 2 || cm.length % 2 !== 0) fail('Gaussian charge/multiplicity line invalid', i + 1);
    var charge = integer(cm[0], i + 1, 'charge'), mult = integer(cm[1], i + 1, 'multiplicity');
    if (mult < 1 || mult > 100000 || Math.abs(charge) > 100000) fail('Invalid charge/multiplicity', i + 1);
    if (cm.length > 2) warn(ctx, 'Additional Gaussian fragment charge/multiplicity pairs are recorded but fragment chemistry is not validated.');
    var fragmentPairs = [];
    for (var c = 2; c < cm.length; c += 2) {
      var fc = integer(cm[c], i + 1, 'fragment charge'), fm = integer(cm[c + 1], i + 1, 'fragment multiplicity');
      if (fm < 1) fail('Invalid fragment multiplicity', i + 1); fragmentPairs.push([fc, fm]);
    }
    var units = /\bunits\s*=\s*\(?\s*(bohr|au)\b/i.test(route.join(' ')) ? 'bohr' : 'angstrom';
    i++; var atoms = [], start = i + 1;
    while (i < lines.length && lines[i].trim()) {
      var t = lines[i].trim().replace(/,/g, ' ').split(/\s+/), label = /^([A-Za-z]{1,2}|\d+)(?:\([^()]*\))?$/.exec(t[0]);
      if (!label || t.length < 4) fail('Gaussian internal/Z-matrix coordinates are not supported; provide Cartesian coordinates', i + 1, 'UNSUPPORTED_INTERNAL_COORDINATES');
      var shift = 1, extra = {};
      if (t.length === 5) { extra.freezeCode = integer(t[1], i + 1, 'freeze code'); shift = 2; }
      else if (t.length !== 4) fail('ONIOM/extended Cartesian atom rows are not supported', i + 1, 'UNSUPPORTED_FORMAT');
      if (t.slice(shift).some(function (s) { return !NUM.test(s); })) fail('Variables/internal coordinates are not supported', i + 1, 'UNSUPPORTED_INTERNAL_COORDINATES');
      atoms.push(atom(label[1], t.slice(shift), i + 1, ctx, units === 'bohr' ? BOHR : 1, extra));
      if (atoms.length > ctx.limits.maxAtoms) fail('Atom limit exceeded', i + 1, 'LIMIT_EXCEEDED'); i++;
    }
    if (lines.slice(i).some(function (l) { return l.trim(); })) warn(ctx, 'Gaussian input footer/connectivity/basis sections are not interpreted.');
    frame(ctx, title.join(' '), atoms, [], { lineStart: start, charge: charge, multiplicity: mult, fragmentCharges: fragmentPairs, route: route.join('\n'), sourceUnits: units, coordinateProvenance: 'input Cartesian coordinates; not optimized', optimizationConverged: null, connectivity: 'not supplied' });
  }
  function parseGaussianOutput(lines, ctx) {
    var latest = null;
    for (var i = 0; i < lines.length; i++) {
      var heading = /^\s*(Standard|Input) orientation:\s*$/i.exec(lines[i]);
      if (!heading) {
        var step = /^\s*Step number\s+(\d+)\s+out of\s+/i.exec(lines[i]);
        if (step && latest) { latest.metadata.optimizationStep = integer(step[1], i + 1, 'optimization step'); latest.metadata.stepEvidenceLine = i + 1; }
        if (/Optimization completed\.|-- Stationary point found\./i.test(lines[i]) && latest) {
          latest.metadata.optimizationConverged = true; latest.metadata.convergenceEvidence = lines[i].trim(); latest.metadata.convergenceLine = i + 1;
        } else if (/Optimization stopped\.|Number of steps exceeded/i.test(lines[i]) && latest) {
          latest.metadata.optimizationConverged = false; latest.metadata.convergenceEvidence = lines[i].trim(); latest.metadata.convergenceLine = i + 1;
        }
        continue;
      }
      var start = i + 1, dash1 = -1, dash2 = -1;
      for (var h = i + 1; h < Math.min(lines.length, i + 12); h++) {
        if (/^\s*-{5,}\s*$/.test(lines[h])) { if (dash1 < 0) dash1 = h; else { dash2 = h; break; } }
      }
      if (dash2 < 0) fail('Truncated Gaussian orientation header', start);
      var header = lines.slice(dash1 + 1, dash2).join(' ');
      if (!/Atomic/i.test(header) || !/Coordinates/i.test(header)) fail('Unrecognized Gaussian orientation columns', start);
      var units = /bohr|a\.u\./i.test(header) ? 'bohr' : 'angstrom';
      var atoms = [], ids = new Set(), j = dash2 + 1;
      for (; j < lines.length && !/^\s*-{5,}\s*$/.test(lines[j]); j++) {
        var t = lines[j].trim().split(/\s+/);
        if (t.length !== 6) fail('Malformed Gaussian orientation atom row', j + 1);
        var serial = integer(t[0], j + 1, 'center number'); integer(t[2], j + 1, 'atomic type');
        if (serial < 1 || ids.has(serial)) fail('Invalid/duplicate Gaussian center number', j + 1); ids.add(serial);
        atoms.push(atom(t[1], t.slice(3), j + 1, ctx, units === 'bohr' ? BOHR : 1, { serial: serial }));
        if (atoms.length > ctx.limits.maxAtoms) fail('Atom limit exceeded', j + 1, 'LIMIT_EXCEEDED');
      }
      if (j >= lines.length) fail('Gaussian orientation closing separator missing', start);
      latest = frame(ctx, heading[1] + ' orientation ' + (ctx.frames.length + 1), atoms, [], { lineStart: start, lineEnd: j + 1, sourceUnits: units, orientation: heading[1].toLowerCase(), optimizationConverged: null, coordinateProvenance: 'output geometry; last output is not necessarily last converged', connectivity: 'not supplied' });
      i = j;
    }
    warn(ctx, 'Output frames are not necessarily optimized minima. Convergence markers label only the preceding coordinate block; no energies or frequency validity are inferred.');
  }
  function parseOrcaOutput(lines, ctx) {
    var latest = null, cycle = null;
    for (var i = 0; i < lines.length; i++) {
      var heading = /^\s*CARTESIAN COORDINATES\s*\((ANGSTROEM|ANGSTROM|A\.U\.)\)\s*$/i.exec(lines[i]);
      if (!heading) {
        var cycleMatch = /GEOMETRY OPTIMIZATION CYCLE\s+(\d+)\b/i.exec(lines[i]);
        if (cycleMatch) cycle = integer(cycleMatch[1], i + 1, 'optimization cycle');
        if (/THE OPTIMIZATION HAS CONVERGED\b/i.test(lines[i]) && latest) { latest.metadata.optimizationConverged = true; latest.metadata.convergenceLine = i + 1; latest.metadata.convergenceEvidence = lines[i].trim(); cycle = null; }
        else if (/THE OPTIMIZATION DID NOT CONVERGE|OPTIMIZATION HAS NOT CONVERGED/i.test(lines[i]) && latest) { latest.metadata.optimizationConverged = false; latest.metadata.convergenceLine = i + 1; latest.metadata.convergenceEvidence = lines[i].trim(); cycle = null; }
        continue;
      }
      var start = i + 1, units = /^A\.U\.$/i.test(heading[1]) ? 'bohr' : 'angstrom', j = i + 1;
      while (j < lines.length && (!lines[j].trim() || /^\s*-+\s*$/.test(lines[j]) || /^\s*NO\s+LB\s+/i.test(lines[j]))) j++;
      var atoms = [], style = null;
      for (; j < lines.length && lines[j].trim() && !/^\s*-+\s*$/.test(lines[j]); j++) {
        var t = lines[j].trim().split(/\s+/), extra = {}, el, coords;
        if (t.length === 4) { el = t[0]; coords = t.slice(1); if (style && style !== 'plain') fail('Mixed ORCA coordinate row styles', j + 1); style = 'plain'; }
        else if (t.length === 8 && units === 'bohr') {
          extra.serial = integer(t[0], j + 1, 'ORCA atom number');
          var za = number(t[2], j + 1, 'nuclear charge'); integer(t[3], j + 1, 'fragment'); number(t[4], j + 1, 'mass');
          el = element(t[1], j + 1);
          if (extra.serial < 0 || za !== SYMBOLS.indexOf(el) + 1) fail('Invalid ORCA atom index/nuclear charge', j + 1);
          coords = t.slice(5); if (style && style !== 'indexed') fail('Mixed ORCA coordinate row styles', j + 1); style = 'indexed';
        } else fail('Malformed/unsupported ORCA coordinate row', j + 1);
        atoms.push(atom(el, coords, j + 1, ctx, units === 'bohr' ? BOHR : 1, extra));
        if (atoms.length > ctx.limits.maxAtoms) fail('Atom limit exceeded', j + 1, 'LIMIT_EXCEEDED');
      }
      latest = frame(ctx, 'ORCA ' + units + ' geometry ' + (ctx.frames.length + 1), atoms, [], { lineStart: start, lineEnd: j + 1, sourceUnits: units, optimizationStep: cycle, optimizationConverged: null, coordinateProvenance: 'output geometry; last output is not necessarily last converged', connectivity: 'not supplied' });
      i = j - 1;
    }
    warn(ctx, 'ORCA output blocks can repeat the same geometry in different units. Convergence labels use only explicit markers on the preceding block; no energies/minimum/TS identity are inferred.');
  }
  function parseOrcaInput(lines, ctx) {
    if (lines.some(function (l) { return /^\s*\$new_job\b/i.test(l); })) fail('Multi-job ORCA input must be split before viewing', undefined, 'UNSUPPORTED_FORMAT');
    var clean = lines.map(function (l) { return l.replace(/#.*/, '').trim(); });
    var keywords = clean.filter(function (l) { return /^!/.test(l); }).map(function (l) { return l.slice(1); }).join(' ');
    var bohr = /(?:^|\s)bohrs?(?:\s|$)/i.test(keywords), angs = /(?:^|\s)angs(?:\s|$)/i.test(keywords);
    if (bohr && angs) fail('Ambiguous ORCA unit specifications', undefined, 'UNSUPPORTED_FORMAT');
    var units = bohr ? 'bohr' : 'angstrom', start, end, charge, mult, mode;
    var star = clean.findIndex(function (l) { return /^\*\s*\S+/.test(l); });
    var block = clean.findIndex(function (l) { return /^%coords\s*$/i.test(l); });
    if (star >= 0 && block >= 0) fail('Combined ORCA star/%coords forms are not supported; provide one explicit Cartesian block', undefined, 'UNSUPPORTED_FORMAT');
    if (star >= 0) {
      var head = /^\*\s*(\S+)\s+([+-]?\d+)\s+([+-]?\d+)\s*$/i.exec(clean[star]);
      if (/^\*\s*(?:xyzfile|gzmtfile)\b/i.test(clean[star])) fail('ORCA external coordinate reference: open the referenced XYZ separately; no file is read implicitly', star + 1, 'EXTERNAL_COORDINATES_REQUIRED');
      if (!head || head[1].toLowerCase() !== 'xyz') fail('Only explicit ORCA Cartesian xyz input is supported', star + 1, 'UNSUPPORTED_INTERNAL_COORDINATES');
      charge = integer(head[2], star + 1, 'charge'); mult = integer(head[3], star + 1, 'multiplicity');
      start = star + 1; end = start;
      while (end < clean.length && clean[end] !== '*') end++;
      if (end === clean.length) fail('ORCA Cartesian closing star missing', star + 1);
      if (clean.slice(end + 1).some(function (l) { return /^\*\s*\S+/.test(l); })) fail('Multiple ORCA input geometries must be split', end + 1, 'UNSUPPORTED_FORMAT');
      mode = 'star xyz';
    } else if (block >= 0) {
      var fields = {}, i = block + 1;
      for (; i < clean.length && clean[i].toLowerCase() !== 'coords'; i++) {
        if (!clean[i]) continue;
        var entry = /^(ctyp|charge|mult|units?)\s+(\S+)\s*$/i.exec(clean[i]);
        if (!entry || fields[entry[1].toLowerCase().replace(/^unit$/, 'units')] !== undefined) fail('Unsupported/duplicate ORCA %coords field', i + 1, 'UNSUPPORTED_FORMAT');
        fields[entry[1].toLowerCase().replace(/^unit$/, 'units')] = entry[2];
      }
      if (i === clean.length || String(fields.ctyp).toLowerCase() !== 'xyz' || fields.charge === undefined || fields.mult === undefined) fail('ORCA %coords needs explicit CTyp xyz, Charge, Mult and coords', block + 1, 'UNSUPPORTED_FORMAT');
      charge = integer(fields.charge, block + 1, 'charge'); mult = integer(fields.mult, block + 1, 'multiplicity');
      if (fields.units !== undefined) {
        if (!/^(angs|angstrom|bohrs?)$/i.test(fields.units)) fail('Unknown ORCA coordinate unit', block + 1, 'UNSUPPORTED_FORMAT');
        var specified = /^bohr/i.test(fields.units) ? 'bohr' : 'angstrom';
        if ((bohr || angs) && specified !== units) fail('Ambiguous ORCA unit specifications', block + 1, 'UNSUPPORTED_FORMAT');
        units = specified;
      }
      start = i + 1; end = start;
      while (end < clean.length && clean[end].toLowerCase() !== 'end') end++;
      var closing = end + 1; while (closing < clean.length && !clean[closing]) closing++;
      if (end === clean.length || closing >= clean.length || clean[closing].toLowerCase() !== 'end') fail('ORCA %coords closing end missing', block + 1);
      mode = '%coords xyz';
    } else fail('ORCA input contains no supported Cartesian block', undefined, 'NO_COORDINATES');
    if (mult < 1 || mult > 100000 || Math.abs(charge) > 100000) fail('Invalid charge/multiplicity', start);
    var atoms = [];
    for (var j = start; j < end; j++) {
      if (!clean[j]) continue;
      var t = clean[j].split(/\s+/), label = /^([A-Za-z]{1,2}|\d+)(?:\((\d+)\))?$/.exec(t[0]);
      if (!label || t.length !== 4) fail('ORCA ghost/dummy/extended or internal atom row is unsupported', j + 1, 'UNSUPPORTED_FORMAT');
      var extra = {}, frozen = [];
      var coords = t.slice(1).map(function (s, k) { if (/\$$/.test(s)) frozen.push(['x','y','z'][k]); return s.replace(/\$$/, ''); });
      if (label[2] !== undefined) extra.fragment = integer(label[2], j + 1, 'fragment');
      if (frozen.length) extra.frozenAxes = frozen;
      atoms.push(atom(label[1], coords, j + 1, ctx, units === 'bohr' ? BOHR : 1, extra));
      if (atoms.length > ctx.limits.maxAtoms) fail('Atom limit exceeded', j + 1, 'LIMIT_EXCEEDED');
    }
    frame(ctx, 'ORCA input', atoms, [], { lineStart: start + 1, lineEnd: end + 1, charge: charge, multiplicity: mult, sourceUnits: units, inputForm: mode, optimizationConverged: null, coordinateProvenance: 'input Cartesian coordinates; not optimized', connectivity: 'not supplied' });
    warn(ctx, 'ORCA input settings beyond the explicit coordinates/charge/multiplicity are not evaluated.');
  }
  function parseFchk(lines, ctx) {
    var wanted = new Set(['Number of atoms', 'Atomic numbers', 'Current cartesian coordinates', 'Charge', 'Multiplicity']);
    var fields = Object.create(null), origins = Object.create(null);
    for (var i = 0; i < lines.length; i++) {
      var h = /^(.*?)\s+([IR])\s+(?:N=\s*(\d+)\s*|([+-]?\d+)\s*)$/.exec(lines[i]);
      if (!h || !wanted.has(h[1].trim())) continue;
      var key = h[1].trim();
      if (fields[key] !== undefined) fail('Duplicate formatted checkpoint field: ' + key, i + 1);
      origins[key] = i + 1;
      var isCoords = key === 'Current cartesian coordinates', isArray = isCoords || key === 'Atomic numbers';
      if (h[2] !== (isCoords ? 'R' : 'I') || isArray !== (h[3] !== undefined)) fail('Invalid formatted checkpoint field type: ' + key, i + 1);
      if (!isArray) { fields[key] = integer(h[4], i + 1, key); continue; }
      var n = integer(h[3], i + 1, 'array length'), cap = ctx.limits.maxAtoms * (isCoords ? 3 : 1);
      if (n < 1 || n > cap) fail('Formatted checkpoint array size outside limit', i + 1, 'LIMIT_EXCEEDED');
      var values = [], j = i + 1;
      while (values.length < n && j < lines.length) {
        var tokens = lines[j].trim().split(/\s+/);
        if (!lines[j].trim()) { j++; continue; }
        for (var k = 0; k < tokens.length; k++) {
          values.push(isCoords ? number(tokens[k], j + 1, 'checkpoint coordinate') : integer(tokens[k], j + 1, 'atomic number'));
          if (values.length > n) fail('Formatted checkpoint array has excess values', j + 1);
        }
        j++;
      }
      if (values.length !== n) fail('Truncated formatted checkpoint array: ' + key, i + 1);
      if (j < lines.length && /^\s*[+-]?(?:\d|\.)/.test(lines[j])) fail('Formatted checkpoint array has undeclared trailing values', j + 1);
      fields[key] = values; i = j - 1;
    }
    var count = fields['Number of atoms'], numbers = fields['Atomic numbers'], xyz = fields['Current cartesian coordinates'];
    if (!Number.isSafeInteger(count) || !numbers || !xyz) fail('Formatted checkpoint lacks Number of atoms, Atomic numbers or Current cartesian coordinates', undefined, 'NO_COORDINATES');
    countAtoms(count, ctx, origins['Number of atoms']);
    if (numbers.length !== count || xyz.length !== count * 3) fail('Formatted checkpoint atom/coordinate array counts disagree');
    var atoms = numbers.map(function (z, index) { return atom(String(z), xyz.slice(index * 3, index * 3 + 3).map(String), origins['Current cartesian coordinates'], ctx, BOHR); });
    var metadata = { lineStart: origins['Current cartesian coordinates'], sourceUnits: 'bohr', optimizationConverged: null, coordinateProvenance: 'formatted checkpoint Cartesian coordinates; convergence not established', connectivity: 'not supplied' };
    if (fields.Charge !== undefined) metadata.charge = fields.Charge;
    if (fields.Multiplicity !== undefined) { if (fields.Multiplicity < 1 || fields.Multiplicity > 100000) fail('Invalid checkpoint multiplicity'); metadata.multiplicity = fields.Multiplicity; }
    frame(ctx, 'Formatted checkpoint coordinates', atoms, [], metadata);
    warn(ctx, 'Formatted checkpoint coordinates do not by themselves establish optimization convergence or minimum/TS validity.');
  }
  function selectFrames(parsed, selector) {
    if (!parsed || !Array.isArray(parsed.frames) || !parsed.frames.length) fail('No parsed frames available', undefined, 'INVALID_ARGUMENT');
    selector = selector === undefined ? 'all' : String(selector).trim().toLowerCase();
    var n = parsed.frames.length;
    if (selector === 'all') return parsed.frames.map(function (_, i) { return i; });
    if (selector === 'first') return [0];
    if (selector === 'last') return [n - 1];
    if (selector === 'last-converged') {
      for (var i = n - 1; i >= 0; i--) if (parsed.frames[i].metadata && parsed.frames[i].metadata.optimizationConverged === true) return [i];
      fail('No coordinate block has an explicit optimization-convergence marker; last frame is not a substitute', undefined, 'NO_CONFIRMED_CONVERGENCE');
    }
    if (!/^[1-9]\d*$/.test(selector)) fail('Frame must be all, first, last, last-converged or a 1-based positive index', undefined, 'INVALID_ARGUMENT');
    var index = Number(selector);
    if (!Number.isSafeInteger(index) || index > n) fail('Frame index outside available frames', undefined, 'INVALID_ARGUMENT');
    return [index - 1];
  }
  function toXYZ(parsed, selector, origin) {
    return selectFrames(parsed, selector).map(function (index) {
      var f = parsed.frames[index], m = f.metadata || {};
      if (!Array.isArray(f.atoms) || !f.atoms.length) fail('Cannot export an empty frame', undefined, 'INVALID_ARGUMENT');
      var info = Object.assign({}, origin || {}, { format: parsed.format, sourceFrame: index + 1, units: 'angstrom', sourceUnits: m.sourceUnits || null, lineStart: m.lineStart || null, optimizationConverged: m.optimizationConverged === true ? true : m.optimizationConverged === false ? false : null, charge: m.charge === undefined ? null : m.charge, multiplicity: m.multiplicity === undefined ? null : m.multiplicity, connectivity: 'XYZ does not preserve bond orders; atom order and coordinates retained' });
      var rows = f.atoms.map(function (a) { point(a); return element(a.element) + ' ' + [a.x,a.y,a.z].map(String).join(' '); });
      return [String(f.atoms.length), JSON.stringify(info)].concat(rows).join('\n') + '\n';
    }).join('');
  }
  function detect(text, filename, override) {
    var aliases = { xyz: 'xyz', sdf: 'sdf', mol: 'mol', pdb: 'pdb', gjf: 'gaussian-input', com: 'gaussian-input', inp: 'orca-input', fchk: 'gaussian-fchk', fch: 'gaussian-fchk', 'gaussian-input': 'gaussian-input', 'gaussian-output': 'gaussian-output', 'orca-input': 'orca-input', 'orca-output': 'orca-output', 'gaussian-fchk': 'gaussian-fchk' };
    if (/^GIF8[79]a/.test(text)) fail('GIF images do not provide Cartesian atom coordinates; Gaussian inputs use .gjf', undefined, 'UNSUPPORTED_FORMAT');
    if (/^\s*Atomic numbers\s+I\s+N=/m.test(text) && /^\s*Current cartesian coordinates\s+R\s+N=/m.test(text) && override === undefined) return 'gaussian-fchk';
    if (override !== undefined) { if (!aliases[override]) fail('Unknown requested format', undefined, 'UNSUPPORTED_FORMAT'); return aliases[override]; }
    var ext = String(filename || '').split('.').pop().toLowerCase();
    if (aliases[ext]) return aliases[ext];
    if (ext === 'ent') return 'pdb';
    if (ext === 'smi' || ext === 'smiles' || ext === 'cif') fail('SMILES/CIF is not a supplied Cartesian structure; explicit external conversion is required', undefined, 'UNSUPPORTED_FORMAT');
    var gaussian = /^\s*(?:Standard|Input) orientation:\s*$/im.test(text), orca = /^\s*CARTESIAN COORDINATES\s*\((?:ANGSTROEM|ANGSTROM|A\.U\.)\)\s*$/im.test(text);
    if (gaussian && orca) fail('Ambiguous mixed Gaussian/ORCA file; select an explicit format', undefined, 'UNSUPPORTED_FORMAT');
    if (gaussian) return 'gaussian-output'; if (orca) return 'orca-output';
    if (/^\s*\*\s*(?:xyz|xyzfile|int|internal|gzmt)\b/im.test(text) || /^\s*%coords\b/im.test(text)) return 'orca-input';
    if (/^(?:ATOM  |HETATM|MODEL )/m.test(text)) return 'pdb';
    if (/^\s*#/m.test(text)) return 'gaussian-input';
    if (/V2000|V3000/.test(text)) return /\$\$\$\$/m.test(text) ? 'sdf' : 'mol';
    if (/^\s*\d+\s*\n/.test(text)) return 'xyz';
    fail('Unsupported format or no Cartesian coordinate block found', undefined, 'UNSUPPORTED_FORMAT');
  }
  function parse(text, filename, options) {
    options = options || {};
    if (typeof text !== 'string') fail('Input must be text', undefined, 'INVALID_ARGUMENT');
    var limits = Object.assign({}, DEFAULT_LIMITS, options.limits || {});
    Object.keys(limits).forEach(function (key) {
      if (!(key in HARD_LIMITS) || !Number.isFinite(limits[key]) || limits[key] <= 0 || limits[key] > HARD_LIMITS[key] || (key !== 'maxCoordinateAbs' && !Number.isSafeInteger(limits[key]))) fail('Invalid parser limit: ' + key, undefined, 'INVALID_ARGUMENT');
    });
    if (text.length > limits.maxBytes) fail('Input size limit exceeded', undefined, 'LIMIT_EXCEEDED');
    var bytes = typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(text).byteLength : text.length * 3;
    if (bytes > limits.maxBytes) fail('UTF-8 input size limit exceeded', undefined, 'LIMIT_EXCEEDED');
    if (text.indexOf('\0') !== -1) fail('NUL/binary input is not supported');
    text = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    if (!text.trim()) fail('Empty input', undefined, 'EMPTY_INPUT');
    var format = detect(text, filename, options.format), ctx = { frames: [], total: 0, warnings: [], limits: limits }, lines = text.split('\n');
    try {
      if (format === 'xyz') parseXYZ(lines, ctx);
      else if (format === 'sdf' || format === 'mol') parseSDF(lines, ctx, format);
      else if (format === 'pdb') parsePDB(lines, ctx);
      else if (format === 'gaussian-input') parseGaussianInput(lines, ctx);
      else if (format === 'gaussian-output') parseGaussianOutput(lines, ctx);
      else if (format === 'orca-output') parseOrcaOutput(lines, ctx);
      else if (format === 'orca-input') parseOrcaInput(lines, ctx);
      else if (format === 'gaussian-fchk') parseFchk(lines, ctx);
      if (!ctx.frames.length) fail('No coordinate frames found', undefined, 'NO_COORDINATES');
    } catch (err) { if (err instanceof ParseError) err.format = format; throw err; }
    ctx.frames.forEach(function (f, i) { f.metadata.frameIndex = i; f.metadata.isLastOutputFrame = i === ctx.frames.length - 1 && /-output$/.test(format); });
    return { format: format, frames: ctx.frames, warnings: ctx.warnings };
  }
  function point(p) {
    if (!p || ['x', 'y', 'z'].some(function (k) { return typeof p[k] !== 'number' || !Number.isFinite(p[k]); })) fail('Measurement requires finite {x,y,z} points', undefined, 'INVALID_ARGUMENT');
    return [p.x, p.y, p.z];
  }
  function subtract(a, b) { var v = a.map(function (n, i) { return n - b[i]; }); if (v.some(function (n) { return !Number.isFinite(n); })) fail('Measurement overflow', undefined, 'INVALID_ARGUMENT'); return v; }
  function norm(v) { return Math.hypot(v[0], v[1], v[2]); }
  function unit(v) { var n = norm(v); if (!Number.isFinite(n) || n <= 1e-12) fail('Degenerate measurement: coincident/invalid points', undefined, 'DEGENERATE_GEOMETRY'); return v.map(function (x) { return x / n; }); }
  function dot(a, b) { return a.reduce(function (s, x, i) { return s + x * b[i]; }, 0); }
  function cross(a, b) { return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]; }
  function measureDistance(a, b) { var d = norm(subtract(point(a), point(b))); if (!Number.isFinite(d)) fail('Measurement overflow', undefined, 'INVALID_ARGUMENT'); return d; }
  function measureAngle(a, b, c) { b = point(b); var u = unit(subtract(point(a), b)), v = unit(subtract(point(c), b)); return Math.acos(Math.max(-1, Math.min(1, dot(u, v)))) * 180 / Math.PI; }
  function measureDihedral(a, b, c, d) {
    a = point(a); b = point(b); c = point(c); d = point(d);
    var u = unit(subtract(b, a)), v = unit(subtract(c, b)), w = unit(subtract(d, c));
    var n1 = cross(u, v), n2 = cross(v, w);
    if (norm(n1) <= 1e-12 || norm(n2) <= 1e-12) fail('Degenerate dihedral: collinear bonds', undefined, 'DEGENERATE_GEOMETRY');
    n1 = unit(n1); n2 = unit(n2);
    return Math.atan2(dot(cross(n1, n2), v), dot(n1, n2)) * 180 / Math.PI;
  }
  return Object.freeze({ parse: parse, selectFrames: selectFrames, toXYZ: toXYZ, measureDistance: measureDistance, measureAngle: measureAngle, measureDihedral: measureDihedral, MoleculeParseError: ParseError, DEFAULT_LIMITS: DEFAULT_LIMITS, BOHR_TO_ANGSTROM: BOHR, elements: Object.freeze(SYMBOLS.slice()) });
});
