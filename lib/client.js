window.__ModuleLoader__.load({ id: 'dsh-molecular-viewer', factory: require => {
  const React = require('react');
  const h = React.createElement;
  const TAB = 'molecular-viewer';
  const VIEWER = 'molecular-viewer:file';
  const MAX_BYTES = 32 * 1024 * 1024;
  const id = () => globalThis.crypto?.randomUUID?.() || `mol-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  function apply(ctx) {
    const sidebar = ctx.betterSidebar;
    if (!sidebar?.registerTab || !sidebar?.registerFileViewer || !sidebar?.hostRouteUrl) {
      console.warn('[molecular-viewer] Current sidebar extension API unavailable; use offline backup.'); return;
    }
    const route = path => sidebar.hostRouteUrl(path);
    function MoleculePane(props) {
      const frame = React.useRef(null);
      const [ready, setReady] = React.useState(false);
      const [loadGeneration, setLoadGeneration] = React.useState(0);
      const replyTimer = React.useRef(null);
      const [status, setStatus] = React.useState('正在加载本地三维界面…');
      const [error, setError] = React.useState('');
      const request = React.useRef(null);
      const path = props.path || props.tab?.path;
      const selection = props.frame || props.tab?.frame || 'all';
      const origin = new URL(route('molecular-viewer/'), location.href).origin;
      const send = data => frame.current?.contentWindow?.postMessage(data, origin);
      React.useEffect(() => {
        const receive = event => {
          if (event.origin !== origin || event.source !== frame.current?.contentWindow) return;
          const data = event.data;
          if (!data || typeof data !== 'object') return;
          if (data.type === 'dsh-molecule:ready') { if (data.ready === true) { setReady(true); setError(''); setStatus('就绪：可手动打开文件或拖入文件'); } else { setReady(false); setError('本地渲染器或解析器未就绪；请检查 WebGL 和离线资源。'); setStatus('查看器未就绪'); } }
          if (data.requestId === request.current && data.type === 'dsh-molecule:load-result' && data.ok === true && data.summary?.rendered === true) {
            clearTimeout(replyTimer.current); setStatus(`已打开：${data.filename || path || ''} · ${Number(data.summary?.atomCount) || 0} 原子`); setError('');
          }
          if (data.requestId === request.current && data.type === 'dsh-molecule:error') { clearTimeout(replyTimer.current); setError(String(data.message || '文件解析失败')); setStatus('未完成打开'); }
        };
        window.addEventListener('message', receive);
        return () => window.removeEventListener('message', receive);
      }, [origin, path]);
      React.useEffect(() => {
        if (ready) return;
        const timer = setTimeout(() => { setError('查看器握手超时；请检查本地资源、WebGL或刷新此标签。'); setStatus('未完成加载'); }, 15000);
        return () => clearTimeout(timer);
      }, [ready, loadGeneration]);
      React.useEffect(() => {
        if (!ready) return;
        if (!path) { setStatus('就绪：可手动打开文件或拖入文件'); return; }
        const controller = new AbortController();
        const requestId = id(); request.current = requestId;
        setError(''); setStatus(`正在读取：${path}`);
        const readTimer = setTimeout(() => { if (request.current === requestId) { request.current = null; controller.abort(); setError('文件读取超时；未确认文件已打开。'); setStatus('未完成打开'); } }, 30000);
        (async () => {
          let text = props.content;
          if (props.largeFile) throw new Error('DSH 标记此文件过大；请在离线版手动选择较小文件，不绕过文件限制。');
          if (typeof text !== 'string') {
            if (!props.scope?.sessionId) throw new Error('缺少会话作用域，未读取文件。');
            const scope = props.scope;
            const response = await fetch(route('sidebar/api/fs.read'), {
              method: 'POST', headers: { 'content-type': 'application/json' }, signal: controller.signal,
              body: JSON.stringify({ sessionId: scope.sessionId, ...(scope.cwd ? { cwd: scope.cwd } : {}), ...(scope.repoRoot ? { repoRoot: scope.repoRoot } : {}), path })
            });
            const envelope = await response.json();
            if (!response.ok || envelope.ok !== true) throw new Error(envelope.error?.message || `文件读取失败：HTTP ${response.status}`);
            text = envelope.value?.content;
            if (typeof text !== 'string') throw new Error('文件内容未完整提供（可能过大或不是文本）；未冒称已打开。');
          }
          if (new TextEncoder().encode(text).byteLength > MAX_BYTES) throw new Error('文件超过 32 MiB 查看限制。');
          if (controller.signal.aborted) return;
          clearTimeout(readTimer);
          setStatus(`正在解析：${path}`);
          replyTimer.current = setTimeout(() => { if (request.current === requestId) { request.current = null; setError('解析/显示回执超时；未确认文件已打开。'); setStatus('未完成打开'); } }, 30000);
          send({ type: 'dsh-molecule:load', requestId, frame: selection, filename: path.split(/[\\/]/).pop(), text });
        })().catch(failure => { clearTimeout(readTimer); if (!controller.signal.aborted) { setError(String(failure.message || failure)); setStatus('未完成打开'); } });
        return () => { controller.abort(); clearTimeout(readTimer); clearTimeout(replyTimer.current); request.current = null; };
      }, [ready, loadGeneration, path, props.content, props.scope?.sessionId, props.scope?.cwd, selection]);
      return h('div', { style: { height: '100%', minHeight: '340px', display: 'flex', flexDirection: 'column', background: '#111827', color: '#e5e7eb' }, 'data-molecule-pane': true },
        h('div', { role: 'status', style: { padding: '7px 10px', fontSize: '12px', flexShrink: 0 } }, status),
        error && h('div', { role: 'alert', style: { padding: '8px 10px', color: '#fecaca', whiteSpace: 'pre-wrap' } }, error),
        h('iframe', { ref: frame, src: route('molecular-viewer/'), title: '分子三维查看器', sandbox: 'allow-scripts allow-same-origin allow-downloads', onLoad: () => { setReady(false); request.current = null; clearTimeout(replyTimer.current); setLoadGeneration(value => value + 1); setStatus('正在加载本地三维界面…'); send({ type: 'dsh-molecule:ping' }); }, style: { width: '100%', flex: 1, minHeight: '300px', border: 0 } })
      );
    }
    ctx.effect(() => sidebar.registerTab({
      id: TAB, title: '分子三维', description: '打开已有三维坐标，切换构象、测量及导出；不生成或优化结构。', icon: '⚛', order: 45,
      dedupeKey: tab => tab.path ? `${tab.path}\nframe:${tab.frame || 'all'}` : 'molecular-viewer:manual',
      createTab: () => ({ tab: { id: id(), type: TAB, title: '分子三维' } }), component: MoleculePane
    }), 'molecular-viewer:tab');
    ctx.effect(() => sidebar.registerFileViewer({
      id: VIEWER, title: '分子三维', exts: ['xyz', 'sdf', 'mol', 'pdb', 'ent', 'gjf', 'com', 'inp', 'fchk', 'fch'], priority: 30, fetchStrategy: 'fsRead',
      detect: (path, head) => /\.(?:out|log|output)$/i.test(path) && /Gaussian|O\s+R\s+C\s+A|CARTESIAN COORDINATES|Standard orientation:|Input orientation:/i.test(new TextDecoder().decode(head)),
      component: MoleculePane
    }), 'molecular-viewer:files');
    ctx.effect(() => {
      let stopped = false, running = false;
      const cursors = new Map();
      async function poll() {
        if (stopped || running || document.hidden || !sidebar.isTabEnabled(TAB)) return;
        const snapshot = sidebar.getSnapshot();
        const sessionId = snapshot.sessionId;
        if (!sessionId) return;
        running = true;
        try {
          const response = await fetch(`${route('molecular-viewer/requests')}?sessionId=${encodeURIComponent(sessionId)}&after=${cursors.get(sessionId) || 0}`, { cache: 'no-store' });
          if (!response.ok) return;
          const envelope = await response.json();
          if (!envelope.ok || !Array.isArray(envelope.requests)) return;
          if (stopped || sidebar.getSnapshot().sessionId !== sessionId) return;
          for (const item of envelope.requests) {
            if (typeof item.path !== 'string' || !Number.isSafeInteger(item.sequence)) continue;
            sidebar.openTab({ type: TAB, path: item.path, frame: item.frame || 'all', title: item.title || '分子三维' }, { sessionId });
            cursors.set(sessionId, item.sequence);
          }
        } catch { /* A disconnected GUI does not convert queued requests into success. */ }
        finally { running = false; }
      }
      const timer = setInterval(poll, 1500);
      const unsubscribe = sidebar.subscribeState(poll);
      poll();
      return () => { stopped = true; clearInterval(timer); unsubscribe(); };
    }, 'molecular-viewer:queue-poll');
  }
  return { inject: ['betterSidebar'], apply };
} });
