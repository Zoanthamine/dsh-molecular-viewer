/* Local-only molecular viewer. Coordinates are immutable; no uploads or persistence. */
(() => {
  'use strict';
  const MAX_TEXT = 32 * 1024 * 1024;
  const MAX_FRAME_ATOMS = 10000;
  const MAX_FRAMES = 500;
  const MAX_TOTAL_ATOMS = 100000;
  const MAX_LABELS = 400;
  const $ = (id) => document.getElementById(id);
  const state = { files: [], activeId: null, frameIndex: 0, nextId: 1, viewer: null, model: null, selected: [], measurements: [], displayBonds: [], inferred: false, displayWarning: null, error: null, busy: false };
  let loadQueue = Promise.resolve();
  let resizeScheduled = false;
  const sources = { file: '本地文件', paste: '粘贴坐标', demo: '内置水分子示例', bridge: 'DSH 同源文件消息' };
  const modeNames = { distance: '距离', angle: '键角', dihedral: '二面角' };
  const counts = { distance: 2, angle: 3, dihedral: 4 };
  const covalentRadii = { H: .31, D: .31, He: .28, Li: 1.28, B: .84, C: .76, N: .71, O: .66, F: .57, Ne: .58, Na: 1.66, Mg: 1.41, Al: 1.21, Si: 1.11, P: 1.07, S: 1.05, Cl: 1.02, K: 2.03, Ca: 1.76, Fe: 1.32, Co: 1.26, Ni: 1.24, Cu: 1.32, Zn: 1.22, Br: 1.20, I: 1.39 };
  function text(node, value) { node.textContent = String(value == null ? '—' : value); }
  function coordinate(a) { return { x: a.x, y: a.y, z: a.z }; }
  function el(tag, className, value) { const n = document.createElement(tag); if (className) n.className = className; if (value !== undefined) text(n, value); return n; }
  function safeText(value, limit = 350) {
    let result;
    if (value == null) result = '—';
    else if (typeof value === 'object') { try { result = JSON.stringify(value); } catch (_) { result = '[元数据]'; } }
    else result = String(value);
    return result.length > limit ? result.slice(0, limit) + '…' : result;
  }
  function currentFile() { return state.files.find((f) => f.id === state.activeId) || null; }
  function currentFrame() { const f = currentFile(); return f ? f.frames[state.frameIndex] : null; }
  function status(message, isError = false) { text($('status'), message); $('status').classList.toggle('error', isError); state.error = isError ? String(message) : null; }
  function elementName(value) {
    const v = String(value || '').trim();
    if (!/^[A-Za-z]{1,3}$/.test(v)) throw new Error('元素标记无效；请检查结构文件。');
    return v[0].toUpperCase() + v.slice(1).toLowerCase();
  }
  function validateParsed(parsed) {
    if (!parsed || !Array.isArray(parsed.frames) || !parsed.frames.length) throw new Error('未找到可查看的三维坐标。SMILES 生成 3D 尚未启用。');
    if (parsed.frames.length > MAX_FRAMES) throw new Error(`文件超过 ${MAX_FRAMES} 帧，请先截取需要的构象。`);
    let total = 0;
    const frames = parsed.frames.map((frame, frameIndex) => {
      if (!frame || !Array.isArray(frame.atoms) || !frame.atoms.length) throw new Error(`第 ${frameIndex + 1} 帧没有原子坐标。`);
      if (frame.atoms.length > MAX_FRAME_ATOMS) throw new Error(`第 ${frameIndex + 1} 帧超过 ${MAX_FRAME_ATOMS} 原子，无法安全交互显示。`);
      total += frame.atoms.length;
      if (total > MAX_TOTAL_ATOMS) throw new Error(`文件累计超过 ${MAX_TOTAL_ATOMS} 原子坐标，请截取后打开。`);
      const atoms = frame.atoms.map((a) => {
        if (!a || ![a.x, a.y, a.z].every((v) => typeof v === 'number' && Number.isFinite(v))) throw new Error(`第 ${frameIndex + 1} 帧包含非有限数值坐标。`);
        return { ...a, element: elementName(a.element), x: a.x, y: a.y, z: a.z };
      });
      const bonds = (Array.isArray(frame.bonds) ? frame.bonds : []).map((bond) => {
        const { from, to } = bond;
        const order = bond.order == null ? 1 : Number(bond.order);
        if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0 || from >= atoms.length || to >= atoms.length || from === to || !Number.isFinite(order) || order <= 0 || order > 4) throw new Error(`第 ${frameIndex + 1} 帧的键索引或键级无效。`);
        return { from, to, order };
      });
      return { name: safeText(frame.name || `帧 ${frameIndex + 1}`, 200), atoms, bonds, metadata: frame.metadata && typeof frame.metadata === 'object' ? { ...frame.metadata } : {} };
    });
    const already = state.files.reduce((sum, f) => sum + f.frames.reduce((n, frame) => n + frame.atoms.length, 0), 0);
    if (already + total > MAX_TOTAL_ATOMS) throw new Error(`已打开文件累计将超过 ${MAX_TOTAL_ATOMS} 原子坐标；请先删除不需要的文件。`);
    return { format: safeText(parsed.format || '未知', 50), frames, warnings: Array.isArray(parsed.warnings) ? parsed.warnings.map((w) => safeText(w && w.message ? w.message : w)) : [], totalAtoms: total };
  }
  function inferDisplayBonds(atoms) {
    // Spatial buckets, not valence/bond-order inference. Every inferred line is order 1 for display only.
    const cell = 4.8, grid = new Map(), bonds = [];
    const maxComparisons = 2000000, maxLines = Math.min(120000, atoms.length * 12);
    let comparisons = 0;
    const limitError = () => { const error = new Error('距离连线示意过密，超出安全预算（200万候选 / 最多12万连线）；已关闭推断，仅显示坐标。'); error.code = 'DISPLAY_BOND_LIMIT'; return error; };
    atoms.forEach((a, i) => {
      const pos = [Math.floor(a.x / cell), Math.floor(a.y / cell), Math.floor(a.z / cell)];
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
        const near = grid.get(`${pos[0] + dx},${pos[1] + dy},${pos[2] + dz}`);
        if (!near) continue;
        for (const j of near) {
          if (++comparisons > maxComparisons) throw limitError();
          const b = atoms[j];
          const limit = (covalentRadii[a.element] || 1.25) + (covalentRadii[b.element] || 1.25) + .45;
          const d2 = (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2;
          if (d2 > .1225 && d2 <= limit * limit) { if (bonds.length >= maxLines) throw limitError(); bonds.push({ from: j, to: i, order: 1 }); }
        }
      }
      const key = pos.join(','); if (!grid.has(key)) grid.set(key, []); grid.get(key).push(i);
    });
    return bonds;
  }
  function atomSpecs(frame) {
    state.inferred = frame.bonds.length === 0 && $('inferBonds').checked;
    state.displayWarning = null;
    try { state.displayBonds = state.inferred ? inferDisplayBonds(frame.atoms) : frame.bonds; }
    catch (error) { if (error.code !== 'DISPLAY_BOND_LIMIT') throw error; state.inferred = false; state.displayBonds = []; state.displayWarning = error.message; $('inferBonds').checked = false; }
    const specs = frame.atoms.map((a, i) => ({ elem: a.element, x: a.x, y: a.y, z: a.z, serial: i + 1, bonds: [], bondOrder: [], properties: { viewerAtomIndex: i, sourceSerial: a.serial == null ? i + 1 : a.serial } }));
    if (state.displayBonds.some(b => b.order === 4)) state.displayWarning = '芳香键以单线示意，不作 Kekulé 键级指派；原始 MDL 类型 4 保留在解析数据中。';
    for (const b of state.displayBonds) { const displayOrder = b.order === 4 ? 1 : b.order; specs[b.from].bonds.push(b.to); specs[b.from].bondOrder.push(displayOrder); specs[b.to].bonds.push(b.from); specs[b.to].bondOrder.push(displayOrder); }
    return specs;
  }
  function baseStyle(color) {
    const common = color ? { color } : { colorscheme: 'Jmol' };
    switch ($('displayStyle').value) {
      case 'stick': return { stick: { ...common, radius: .18 } };
      case 'space-fill': return { sphere: { ...common, scale: 1 } };
      default: return { stick: { ...common, radius: .12 }, sphere: { ...common, scale: .28 } };
    }
  }
  function visibleAtomIndices(frame) { return frame.atoms.map((a, i) => i).filter((i) => $('showHydrogens').checked || !['H', 'D'].includes(frame.atoms[i].element)); }
  function renderAnnotations() {
    if (!state.viewer || !state.model) return;
    const frame = currentFrame();
    state.viewer.removeAllShapes(); state.viewer.removeAllLabels();
    if ($('showLabels').checked) {
      for (const i of visibleAtomIndices(frame).slice(0, MAX_LABELS)) state.viewer.addLabel(`${frame.atoms[i].element} ${i + 1}`, { position: coordinate(frame.atoms[i]), fontSize: 10, fontColor: '#31465b', backgroundColor: '#ffffff', backgroundOpacity: .72, showBackground: true, borderThickness: 0 });
    }
    state.selected.forEach((i, order) => { state.viewer.addLabel(`${order + 1} · ${frame.atoms[i].element} ${i + 1}`, { position: coordinate(frame.atoms[i]), fontSize: 12, fontColor: '#fff', backgroundColor: '#176e8b', backgroundOpacity: .9, showBackground: true, borderThickness: 0 }); });
    for (const m of state.measurements.slice(-12)) {
      const points = m.atomIndices.map((i) => coordinate(frame.atoms[i]));
      for (let i = 0; i < points.length - 1; i++) state.viewer.addLine({ start: points[i], end: points[i + 1], color: '#e89422', linewidth: 2 });
      const center = points.reduce((p, a) => ({ x: p.x + a.x / points.length, y: p.y + a.y / points.length, z: p.z + a.z / points.length }), { x: 0, y: 0, z: 0 });
      state.viewer.addLabel(`${m.value.toFixed(3)} ${m.unit}`, { position: center, fontSize: 11, fontColor: '#7b4f12', backgroundColor: '#fff8e7', backgroundOpacity: .85, showBackground: true, borderThickness: 0 });
    }
  }
  function applyStyle() {
    if (!state.viewer || !state.model) return;
    const frame = currentFrame();
    state.model.setStyle({}, baseStyle());
    state.model.setClickable({}, true, clickedAtom);
    if (!$('showHydrogens').checked) { state.model.setStyle({ elem: 'H' }, {}); state.model.setStyle({ elem: 'D' }, {}); state.model.setClickable({ elem: 'H' }, false); state.model.setClickable({ elem: 'D' }, false); }
    for (const i of state.selected) state.model.setStyle({ index: i }, baseStyle('#f6b93b'));
    renderAnnotations(); state.viewer.render();
    text($('renderStats'), `${visibleAtomIndices(frame).length} / ${frame.atoms.length} 原子`);
  }
  function clearMeasurements() { state.selected = []; state.measurements = []; updateMeasurements(); }
  function renderFrame(resetView = true) {
    const file = currentFile(), frame = currentFrame();
    clearMeasurements();
    if (!state.viewer) { updateUI(); return; }
    state.viewer.spin(false); state.viewer.removeAllModels(); state.viewer.removeAllShapes(); state.viewer.removeAllLabels(); state.model = null;
    if (!frame) { state.displayBonds = []; state.inferred = false; state.viewer.render(); updateUI(); return; }
    try {
      state.model = state.viewer.addModel();
      state.model.addAtoms(atomSpecs(frame));
      applyStyle(); if (resetView) state.viewer.zoomTo(); state.viewer.render();
      if ($('autoRotate').checked) state.viewer.spin('y', 1);
      status(`${file.name} · 第 ${state.frameIndex + 1} / ${file.frames.length} 帧`);
    } catch (error) { state.viewer.removeAllModels(); state.model = null; status(`渲染失败：${error.message || error}`, true); }
    updateUI(); scheduleResize();
  }
  function updateFileList() {
    $('fileList').replaceChildren(); text($('fileCount'), state.files.length); $('noFiles').hidden = state.files.length > 0;
    $('clearFiles').disabled = state.files.length === 0;
    for (const file of state.files) {
      const item = el('li', 'file-item' + (file.id === state.activeId ? ' active' : ''));
      const open = el('button', 'file-open'); open.type = 'button'; open.title = file.name; open.setAttribute('aria-pressed', String(file.id === state.activeId));
      open.append(el('span', 'file-name', file.name), el('span', 'file-meta', `${file.format} · ${file.frames.length} 帧 · ${file.frames[0].atoms.length} 原子`));
      open.addEventListener('click', () => { if (state.activeId !== file.id) { stopTrajectory(); state.activeId = file.id; state.frameIndex = 0; renderFrame(); } });
      const remove = el('button', 'file-remove', '×'); remove.type = 'button'; remove.title = '删除此文件'; remove.setAttribute('aria-label', `删除 ${file.name}`); remove.addEventListener('click', () => removeFile(file.id));
      item.append(open, remove); $('fileList').append(item);
    }
  }
  function sourceMetadata(frame) {
    const m = frame.metadata || {};
    const source = m.coordinateSource || m.coordinate_source || m.coordinateProvenance || m.sourceLabel || m.source || m.provenance || '';
    if (/^formatted checkpoint Cartesian/i.test(source)) return '检查点坐标';
    if (/^input Cartesian coordinates/i.test(source)) return '输入坐标';
    if (/^output geometry/i.test(source)) return '输出坐标';
    if (!source || source === 'supplied coordinates') return '文件坐标';
    return safeText(source, 60);
  }
  function shortWarning(message) {
    const translations = [
      [/^Extra XYZ columns/, 'XYZ 的额外列未解析。'],
      [/^Some MDL auxiliary/, '部分 MOL 查询 / 辅助记录未解析。'],
      [/^Unrecognized text after M END/, 'MOL 结束标记后的额外文本未解析。'],
      [/^Duplicate SDF property/, 'SDF 重复属性仅保留最后一项。'],
      [/^Planar coordinates/, '坐标为平面结构，可能是二维坐标。'],
      [/^PDB element column missing/, 'PDB 元素按原子名称推断，请核对。'],
      [/^PDB alternate locations/, 'PDB 已选一个替代位置，详见来源。'],
      [/^PDB duplicate atom names/, 'PDB 重复原子名称已合并。'],
      [/^CONECT references/, '部分 PDB 连接引用无对应原子，已略去。'],
      [/^Additional Gaussian fragment/, 'Gaussian 分片电荷仅记录，未校验化学意义。'],
      [/^Gaussian input footer/, 'Gaussian 的尾部连接 / 基组段未解析。']
    ];
    const match = translations.find(([pattern]) => pattern.test(message));
    return match ? match[1] : safeText(message, 110);
  }
  function warningPresentation(file, frame, options = {}) {
    const routine = /^(XYZ does not encode bond orders;|PDB atom connectivity\/chemical identity is not validated;|Output frames are not necessarily optimized minima\.|ORCA output blocks can repeat the same geometry|ORCA input settings beyond|Formatted checkpoint coordinates do not by themselves)/;
    const warnings = file ? file.warnings || [] : [];
    const notices = warnings.filter((message) => !routine.test(message)).map(shortWarning);
    const details = warnings.filter((message) => !routine.test(message));
    if (frame && !frame.bonds.length) details.push('连接线仅为距离示意，不代表确定键级。');
    if (file && /xyz/i.test(file.format)) details.push('XYZ 的坐标注释不证明优化收敛；需核对原计算输出。');
    if (file && /pdb/i.test(file.format)) details.push('PDB 仅按文件坐标显示，未校验化学身份或优化状态。');
    if (file && /output/i.test(file.format)) details.push('收敛标记只对应邻近坐标块，不证明极小值或过渡态。');
    if (file?.frames?.length > 1) details.push('轨迹是原文件的坐标块序列，可能重复或切换参考坐标系；不做对齐，播放速度不是物理时间。');
    if (file && /orca-output/i.test(file.format)) details.push('ORCA 中不同单位的重复坐标块会各自保留。');
    if (file && /-input$/i.test(file.format)) details.push('输入坐标不是优化结果；仅提取明确笛卡尔坐标。');
    if (file && /fchk/i.test(file.format)) details.push('格式化检查点的 Bohr 坐标已换为 Å；检查点本身不证明优化收敛。');
    if (frame?.metadata?.optimizationConverged === false) notices.unshift('当前帧有未收敛标记。');
    if (options.displayWarning) {
      const message = /芳香键/.test(options.displayWarning) ? '芳香键按单线示意，未指派 Kekulé 键级。' : options.displayWarning;
      notices.push(message); details.push(message);
    }
    if (options.labelsTruncated) notices.push(`编号仅显示前 ${MAX_LABELS} 个可见原子。`);
    if (options.largeFrame) details.push('较大结构可隐藏氢或使用棒状显示，以提高流畅度。');
    if (options.opaqueBridge) notices.push('文件联动不可用，请手动选择文件。');
    return { notices: [...new Set(notices)], details: [...new Set(details)] };
  }
  function updateWarnings() {
    const file = currentFile(), frame = currentFrame();
    const info = warningPresentation(file, frame, {
      displayWarning: state.displayWarning,
      labelsTruncated: Boolean(frame && $('showLabels').checked && visibleAtomIndices(frame).length > MAX_LABELS),
      largeFrame: Boolean(frame && frame.atoms.length > 3000),
      opaqueBridge: window.parent !== window && window.location.origin === 'null'
    });
    for (const [id, items] of [['warnings', info.details], ['importantWarnings', info.notices]]) {
      $(id).replaceChildren();
      for (const message of items.slice(0, 12)) $(id).append(el('li', '', message));
      if (items.length > 12) $(id).append(el('li', '', `另外 ${items.length - 12} 条提示，请核对来源。`));
      $(id).hidden = items.length === 0;
    }
  }
  function updateUI() {
    const file = currentFile(), frame = currentFrame();
    updateFileList(); $('frameSelect').replaceChildren(); $('frameSelect').disabled = !file;
    if (file) file.frames.forEach((f, i) => { const option = el('option', '', `第 ${i + 1} 帧${Number.isSafeInteger(f.metadata.optimizationStep) ? ' · 优化步 ' + f.metadata.optimizationStep : ''}`); option.value = String(i); $('frameSelect').append(option); });
    else $('frameSelect').append(el('option', '', '暂无结构'));
    $('frameSelect').value = String(state.frameIndex);
    $('framePrev').disabled = !file || state.frameIndex === 0; $('frameNext').disabled = !file || state.frameIndex >= file.frames.length - 1;
    text($('frameCounter'), file ? `${state.frameIndex + 1} / ${file.frames.length}` : '— / —');
    text($('currentTitle'), file ? file.name : '打开一个分子结构');
    text($('currentSubtitle'), frame ? `${sourceMetadata(frame)} · 第 ${state.frameIndex + 1} / ${file.frames.length} 帧${Number.isSafeInteger(frame.metadata.optimizationStep) ? ' · 优化步 ' + frame.metadata.optimizationStep : ''} · Å` : '拖入文件即可查看');
    text($('formatValue'), file ? file.format : '—'); text($('atomCountValue'), frame ? frame.atoms.length : '—');
    text($('bondSourceValue'), frame ? (frame.bonds.length ? `${frame.bonds.length} 条文件键` : state.inferred ? `${state.displayBonds.length} 条示意连线` : '仅坐标') : '—');
    text($('sourceValue'), file ? sources[file.source] || file.source : '—');
    $('extraMetadata').replaceChildren();
    if (frame) {
      $('extraMetadata').append(el('dt', '', '原始帧注释'), el('dd', '', safeText(frame.name, 600)));
      for (const [key, value] of Object.entries(frame.metadata).slice(0, 40)) $('extraMetadata').append(el('dt', '', safeText(key, 60)), el('dd', '', safeText(value, 600)));
    }
    $('inferBonds').disabled = !frame || frame.bonds.length > 0;
    $('resetView').disabled = !state.model; $('exportPng').disabled = !state.model;
    $('exportXyz').disabled = !state.model; $('frameLast').disabled = !file;
    $('frameConverged').disabled = !file;
    $('trajectoryPlay').disabled = !file || file.frames.length < 2 || !state.model;
    text($('trajectoryPlay'), trajectoryTimer ? '暂停轨迹' : '播放轨迹');
    $('emptyState').hidden = Boolean(frame && state.model);
    $('interactionNote').hidden = !state.model;
    if (!frame) text($('renderStats'), '0 原子');
    updateWarnings(); updateMeasurements();
  }
  let trajectoryTimer = null;
  function stopTrajectory() {
    if (trajectoryTimer === null) return;
    clearInterval(trajectoryTimer); trajectoryTimer = null; updateUI();
  }
  function startTrajectory() {
    stopTrajectory(); const file = currentFile(); if (!file || file.frames.length < 2 || !state.model) return;
    if (state.frameIndex >= file.frames.length - 1) { state.frameIndex = 0; renderFrame(false); }
    const fps = Number($('trajectorySpeed').value); if (![1, 3, 6].includes(fps)) return;
    trajectoryTimer = setInterval(() => {
      if (document.hidden || $('viewport').getBoundingClientRect().width === 0 || currentFile() !== file || !state.model || state.busy || state.frameIndex >= file.frames.length - 1) { stopTrajectory(); return; }
      state.frameIndex++; renderFrame(false);
      if (state.error || state.frameIndex >= file.frames.length - 1) stopTrajectory();
    }, 1000 / fps);
    updateUI(); status('正在顺序播放坐标帧；播放速度不是物理时间。');
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopTrajectory(); });
  window.addEventListener('pagehide', stopTrajectory);
  $('trajectoryPlay').addEventListener('click', () => { if (trajectoryTimer) stopTrajectory(); else startTrajectory(); });
  $('trajectorySpeed').addEventListener('change', () => { if (trajectoryTimer) startTrajectory(); });
  function removeFile(id) {
    stopTrajectory();
    const oldIndex = state.files.findIndex((f) => f.id === id);
    state.files = state.files.filter((f) => f.id !== id);
    if (state.activeId === id) { state.activeId = state.files[Math.min(oldIndex, state.files.length - 1)]?.id || null; state.frameIndex = 0; renderFrame(); }
    else updateUI();
    if (!state.files.length) status('已清空文件；等待打开结构');
  }
  async function loadText(sourceText, filename, source, selector = 'all') {
    stopTrajectory();
    if (typeof sourceText !== 'string' || !sourceText.trim()) throw new Error('文件/粘贴内容为空。');
    if (sourceText.length > MAX_TEXT) throw new Error('输入文本过大，请截取坐标部分（上限约 32 MiB）。');
    if (!window.MoleculeParsers || typeof window.MoleculeParsers.parse !== 'function') throw new Error('本地 parsers.js 未就绪，请检查离线文件是否完整。');
    const name = safeText(typeof filename === 'string' && filename.trim() ? filename : '未命名结构.xyz', 260);
    if (!state.viewer) throw new Error('本地 WebGL 查看器未就绪，不能载入显示结构。');
    const already = state.files.reduce((sum, f) => sum + f.totalAtoms, 0);
    if (already >= MAX_TOTAL_ATOMS) throw new Error('已达到累计坐标上限；请先删除不需要的文件。');
    const parsed = validateParsed(await window.MoleculeParsers.parse(sourceText, name, { limits: { maxBytes: MAX_TEXT, maxAtoms: MAX_FRAME_ATOMS, maxFrames: MAX_FRAMES, maxTotalAtoms: MAX_TOTAL_ATOMS - already } }));
    const file = { ...parsed, id: `molecule-${state.nextId++}`, name, source };
    const selectedIndex = window.MoleculeParsers.selectFrames(file, selector)[0];
    state.files.push(file); state.activeId = file.id; state.frameIndex = selectedIndex; renderFrame();
    if (!state.model) throw new Error(state.error || '坐标已解析，但未能生成可显示的模型。');
    return { filename: file.name, fileId: file.id, summary: { fileCount: state.files.length, frameCount: file.frames.length, atomCount: file.frames[state.frameIndex].atoms.length, selectedFrame: state.frameIndex + 1, format: file.format, warningsCount: file.warnings.length, rendered: true } };
  }
  function enqueueText(sourceText, filename, source, selector = 'all') {
    const job = loadQueue.then(async () => { state.busy = true; status('正在读取本地坐标…'); try { return await loadText(sourceText, filename, source, selector); } finally { state.busy = false; } });
    loadQueue = job.catch(() => {}); return job;
  }
  async function readFiles(files) {
    for (const file of Array.from(files || [])) {
      try { if (file.size > MAX_TEXT) throw new Error(`${file.name} 超过 32 MiB，请截取坐标后打开。`); await enqueueText(await file.text(), file.name, 'file'); }
      catch (error) { status(`打开失败：${safeText(error.message || error)}`, true); }
    }
  }
  const sub = (a, b) => [a.x - b.x, a.y - b.y, a.z - b.z];
  const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
  const norm = (a) => Math.hypot(...a);
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  function measure(kind, atoms) {
    let result;
    const helpers = window.MoleculeParsers || {};
    const name = { distance: 'measureDistance', angle: 'measureAngle', dihedral: 'measureDihedral' }[kind];
    if (typeof helpers[name] === 'function') result = helpers[name](...atoms);
    else if (kind === 'distance') result = norm(sub(atoms[0], atoms[1]));
    else if (kind === 'angle') {
      const a = sub(atoms[0], atoms[1]), b = sub(atoms[2], atoms[1]);
      if (norm(a) * norm(b) < 1e-12) throw new Error('重合原子不能定义键角。');
      result = Math.acos(Math.max(-1, Math.min(1, dot(a, b) / norm(a) / norm(b)))) * 180 / Math.PI;
    } else {
      const b0 = sub(atoms[0], atoms[1]), b1 = sub(atoms[2], atoms[1]), b2 = sub(atoms[3], atoms[2]);
      if (norm(b1) < 1e-12) throw new Error('重合原子不能定义二面角。');
      const u = b1.map((x) => x / norm(b1));
      const v = b0.map((x, i) => x - dot(b0, u) * u[i]), w = b2.map((x, i) => x - dot(b2, u) * u[i]);
      if (norm(v) * norm(w) < 1e-12) throw new Error('共线原子不能定义二面角。');
      result = Math.atan2(dot(cross(u, v), w), dot(v, w)) * 180 / Math.PI;
    }
    if (typeof result !== 'number' || !Number.isFinite(result)) throw new Error('测量几何退化，无法得到有限数值。');
    return result;
  }
  function selectAtom(index) {
    const frame = currentFrame();
    if (!frame || !Number.isInteger(index) || index < 0 || index >= frame.atoms.length) return false;
    if (!$('showHydrogens').checked && ['H', 'D'].includes(frame.atoms[index].element)) return false;
    const needed = counts[$('measurementMode').value];
    if (state.selected.includes(index)) state.selected = state.selected.filter((i) => i !== index);
    else { if (state.selected.length >= needed) state.selected = []; state.selected.push(index); }
    if (state.selected.length === needed) {
      try {
        const kind = $('measurementMode').value;
        const atomIndices = state.selected.slice(); const value = measure(kind, atomIndices.map((i) => frame.atoms[i]));
        const existing = state.measurements.at(-1);
        if (!existing || existing.kind !== kind || existing.atomIndices.join(',') !== atomIndices.join(',')) state.measurements.push({ kind, atomIndices, value, unit: kind === 'distance' ? 'Å' : '°' });
        if (state.measurements.length > 30) state.measurements.shift();
        status(`${modeNames[kind]}：${value.toFixed(3)} ${kind === 'distance' ? 'Å' : '°'}`);
      } catch (error) { status(error.message || error, true); }
    }
    updateMeasurements(); applyStyle(); return true;
  }
  function clickedAtom(atom) { const index = atom?.properties?.viewerAtomIndex; if (Number.isInteger(index)) selectAtom(index); }
  function updateMeasurements() {
    const frame = currentFrame(); $('selectedAtomList').replaceChildren(); $('measurementResults').replaceChildren();
    if (frame) state.selected.forEach((index) => {
      const a = frame.atoms[index], serial = a.serial == null || a.serial === index + 1 ? '' : ` · 源编号 ${safeText(a.serial, 30)}`;
      $('selectedAtomList').append(el('li', '', `${a.element} ${index + 1}${serial}`));
    });
    for (const m of state.measurements) { const row = el('tr'); row.append(el('td', '', `${modeNames[m.kind]} · ${m.atomIndices.map((i) => i + 1).join('–')}`), el('td', '', `${m.value.toFixed(3)} ${m.unit}`)); $('measurementResults').append(row); }
    const need = counts[$('measurementMode').value];
    text($('selectionHint'), !frame ? `请选择 ${need} 个原子。切换文件 / 帧会清空测量。` : state.selected.length >= need ? '测量已记录；点选下一个原子开始新测量。' : `已选 ${state.selected.length} / ${need}，继续点选原子。`);
    $('clearSelection').disabled = !state.selected.length && !state.measurements.length;
  }
  function scheduleResize() {
    if (resizeScheduled) return; resizeScheduled = true;
    requestAnimationFrame(() => { resizeScheduled = false; if (state.viewer && $('viewport').clientWidth > 0 && $('viewport').clientHeight > 0) { state.viewer.resize(); state.viewer.render(); } });
  }
  function bridgeReady(requestId) {
    const ready = Boolean(state.viewer && window.MoleculeParsers);
    return { type: 'dsh-molecule:ready', requestId, ready, message: ready ? null : state.error || '本地解析器或WebGL查看器未就绪。', capabilities: { localOnly: true, formats: ['XYZ', 'MOL', 'SDF', 'PDB', '计算坐标（以解析器支持为准）'], maxTextBytes: MAX_TEXT, maxAtomsPerFrame: MAX_FRAME_ATOMS, maxFrames: MAX_FRAMES, maxTotalAtoms: MAX_TOTAL_ATOMS, smiles3D: false } };
  }
  function sendParent(message) { if (window.parent !== window && window.location.origin !== 'null') window.parent.postMessage(message, window.location.origin); }
  function requestId(value) { return typeof value === 'string' ? value.slice(0, 128) : typeof value === 'number' && Number.isFinite(value) ? value : undefined; }
  window.addEventListener('message', (event) => {
    if (window.parent === window || event.source !== window.parent || window.location.origin === 'null' || event.origin !== window.location.origin) return;
    const message = event.data;
    if (!message || typeof message !== 'object' || Array.isArray(message)) return;
    const id = requestId(message.requestId);
    if (['dsh-molecule:ping', 'dsh-molecule-ping'].includes(message.type)) { sendParent(bridgeReady(id)); return; }
    if (!['dsh-molecule:load', 'dsh-molecule-load'].includes(message.type)) return;
    if (typeof message.text !== 'string' || (message.filename != null && typeof message.filename !== 'string')) { sendParent({ type: 'dsh-molecule:error', requestId: id, ok: false, message: '消息需要字符串 text / filename。' }); return; }
    if (message.frame !== undefined && typeof message.frame !== 'string') { sendParent({ type: 'dsh-molecule:error', requestId: id, ok: false, message: 'frame 必须是帧选择字符串。' }); return; }
    enqueueText(message.text, message.filename || 'DSH结构.xyz', 'bridge', message.frame || 'all').then((result) => sendParent({ type: 'dsh-molecule:load-result', requestId: id, ok: true, ...result })).catch((error) => { const info = safeText(error.message || error); status(`DSH 文件加载失败：${info}`, true); sendParent({ type: 'dsh-molecule:error', requestId: id, ok: false, message: info }); });
  });
  $('dropZone').addEventListener('click', () => $('fileInput').click());
  $('dropZone').addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); $('fileInput').click(); } });
  $('fileInput').addEventListener('change', (event) => { void readFiles(event.target.files); event.target.value = ''; });
  window.addEventListener('dragover', (event) => { event.preventDefault(); $('dropZone').classList.add('drag-over'); });
  window.addEventListener('dragleave', (event) => { if (!event.relatedTarget) $('dropZone').classList.remove('drag-over'); });
  window.addEventListener('drop', (event) => { event.preventDefault(); $('dropZone').classList.remove('drag-over'); if (event.dataTransfer?.files?.length) void readFiles(event.dataTransfer.files); });
  $('pasteToggle').addEventListener('click', () => { const open = $('pastePanel').hidden; $('pastePanel').hidden = !open; $('pasteToggle').setAttribute('aria-expanded', String(open)); if (open) $('pasteInput').focus(); });
  $('loadPaste').addEventListener('click', () => { enqueueText($('pasteInput').value, $('pasteName').value || '粘贴结构.xyz', 'paste').catch((error) => status(`粘贴失败：${safeText(error.message || error)}`, true)); });
  $('demoButton').addEventListener('click', () => { enqueueText('3\nWater demo; initial illustrative coordinates, Angstrom\nO 0.000000 0.000000 0.000000\nH 0.758602 0.000000 0.504284\nH -0.758602 0.000000 0.504284\n', '水分子示例.xyz', 'demo').catch((error) => status(error.message || error, true)); });
  $('clearFiles').addEventListener('click', () => { stopTrajectory(); state.files = []; state.activeId = null; state.frameIndex = 0; renderFrame(); status('已清空文件；结构未被保存'); });
  $('frameSelect').addEventListener('change', () => { stopTrajectory(); const i = Number($('frameSelect').value); const file = currentFile(); if (file && Number.isInteger(i) && i >= 0 && i < file.frames.length) { state.frameIndex = i; renderFrame(); } });
  $('framePrev').addEventListener('click', () => { stopTrajectory(); if (state.frameIndex > 0) { state.frameIndex--; renderFrame(); } });
  $('frameNext').addEventListener('click', () => { stopTrajectory(); if (currentFile() && state.frameIndex < currentFile().frames.length - 1) { state.frameIndex++; renderFrame(); } });
  function jumpFrame(selector) {
    stopTrajectory();
    const file = currentFile(); if (!file) return;
    try { state.frameIndex = window.MoleculeParsers.selectFrames(file, selector)[0]; renderFrame(); status(`已选择第 ${state.frameIndex + 1} 帧；收敛标记不等于极小值验证。`); }
    catch (error) { status(safeText(error.message || error), true); }
  }
  $('frameLast').addEventListener('click', () => jumpFrame('last'));
  $('frameConverged').addEventListener('click', () => jumpFrame('last-converged'));
  $('exportXyz').addEventListener('click', () => {
    if (!state.model || !currentFile()) return;
    try {
      const value = window.MoleculeParsers.toXYZ(currentFile(), String(state.frameIndex + 1), { sourceName: currentFile().name });
      const uri = URL.createObjectURL(new Blob([value], { type: 'chemical/x-xyz;charset=utf-8' }));
      const link = el('a'); link.href = uri; link.download = (currentFile().name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 90) || 'molecule') + `-frame-${state.frameIndex + 1}.xyz`;
      document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(uri), 1000);
      status('已导出本帧 XYZ；原子顺序与坐标保留，键级及原子属性不保留。');
    } catch (error) { status(`坐标导出失败：${safeText(error.message || error)}`, true); }
  });
  $('displayStyle').addEventListener('change', applyStyle);
  $('showHydrogens').addEventListener('change', () => { clearMeasurements(); applyStyle(); updateWarnings(); });
  $('showLabels').addEventListener('change', () => { applyStyle(); updateWarnings(); });
  $('inferBonds').addEventListener('change', () => renderFrame(false));
  $('autoRotate').addEventListener('change', () => { if (state.viewer) state.viewer.spin($('autoRotate').checked && state.model ? 'y' : false, 1); });
  $('backgroundColor').addEventListener('input', () => { if (state.viewer) { state.viewer.setBackgroundColor($('backgroundColor').value); state.viewer.render(); } });
  $('resetView').addEventListener('click', () => { if (state.viewer && state.model) { state.viewer.zoomTo(); state.viewer.render(); } });
  $('exportPng').addEventListener('click', () => {
    if (!state.viewer || !state.model) return;
    try {
      state.viewer.render(); const uri = state.viewer.pngURI(); if (typeof uri !== 'string' || !uri.startsWith('data:image/png')) throw new Error('渲染器没有返回 PNG 数据。');
      const link = el('a'); link.href = uri; link.download = (currentFile().name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 90) || 'molecule') + `-frame-${state.frameIndex + 1}.png`; document.body.append(link); link.click(); link.remove(); status('已导出当前视角 PNG；未导出或上传结构坐标');
    } catch (error) { status(`截图导出失败：${safeText(error.message || error)}`, true); }
  });
  $('measurementMode').addEventListener('change', () => { state.selected = []; updateMeasurements(); applyStyle(); });
  $('clearSelection').addEventListener('click', () => { clearMeasurements(); applyStyle(); });
  $('toggleSidebar').addEventListener('click', () => { const hidden = $('app').classList.toggle('sidebar-collapsed'); $('toggleSidebar').setAttribute('aria-expanded', String(!hidden)); scheduleResize(); });
  if (window.matchMedia('(max-width:560px)').matches) { $('app').classList.add('sidebar-collapsed'); $('toggleSidebar').setAttribute('aria-expanded', 'false'); }
  if (typeof ResizeObserver === 'function') new ResizeObserver(scheduleResize).observe($('viewport'));
  window.addEventListener('resize', scheduleResize);
  window.MoleculeViewerTest = Object.freeze({
    snapshot() {
      const file = currentFile(), frame = currentFrame();
      const rendered = state.model && typeof state.model.selectedAtoms === 'function' ? state.model.selectedAtoms({}).length : 0;
      return {
        ready: Boolean(state.viewer && window.MoleculeParsers), busy: state.busy, error: state.error, playingTrajectory: trajectoryTimer !== null,
        fileCount: state.files.length, files: state.files.map((f) => ({ id: f.id, name: f.name, format: f.format, frameCount: f.frames.length, totalAtoms: f.totalAtoms, warningsCount: f.warnings.length })),
        currentFileId: file?.id || null, currentFrameIndex: state.frameIndex,
        currentFrame: frame ? { name: frame.name, atomCount: frame.atoms.length, fileBondCount: frame.bonds.length, displayBondCount: state.displayBonds.length, finiteCoordinates: frame.atoms.every((a) => [a.x, a.y, a.z].every(Number.isFinite)), coordinateSource: safeText(sourceMetadata(frame)), optimizationStep: frame.metadata.optimizationStep ?? null, optimizationConverged: frame.metadata.optimizationConverged === true ? true : frame.metadata.optimizationConverged === false ? false : null } : null,
        modelCount: state.model ? 1 : 0, renderedAtomCount: rendered, visibleAtomCount: frame ? visibleAtomIndices(frame).length : 0,
        representation: $('displayStyle').value, showHydrogens: $('showHydrogens').checked, showLabels: $('showLabels').checked, inferBonds: state.inferred, autoRotate: $('autoRotate').checked, backgroundColor: $('backgroundColor').value,
        sidebarCollapsed: $('app').classList.contains('sidebar-collapsed'), messageBridgeEnabled: window.parent !== window && window.location.origin !== 'null',
        measurement: { mode: $('measurementMode').value, selectedAtomIndices: state.selected.slice(), results: state.measurements.map((m) => ({ ...m, atomIndices: m.atomIndices.slice() })) }
      };
    },
    // Bounded domain operation mirroring a visible atom click; no text/eval/coordinate mutation.
    selectAtom(index) { return selectAtom(index); }
  });
  try {
    if (!window.$3Dmol || typeof window.$3Dmol.createViewer !== 'function') throw new Error('本地 vendor/3Dmol-min.js 未加载，请检查离线文件包。');
    state.viewer = window.$3Dmol.createViewer($('viewer'), { backgroundColor: $('backgroundColor').value, antialias: true });
    if (!state.viewer) throw new Error('WebGL 渲染器初始化失败。');
    if (!window.MoleculeParsers) throw new Error('本地 parsers.js 未加载，请检查离线文件包。');
    status('等待打开结构 · 本地渲染');
  } catch (error) { state.viewer = null; state.model = null; status(safeText(error.message || error), true); text($('emptyState').querySelector('h2'), '查看器未就绪'); text($('emptyState').querySelector('p'), '请检查本地脚本是否完整，以及浏览器是否支持 WebGL。'); }
  updateUI(); scheduleResize(); sendParent(bridgeReady());
})();
