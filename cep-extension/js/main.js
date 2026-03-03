/**
 * CreativeClaw CEP Bridge — Panel Script
 * Connects to the gateway WebSocket and executes operations inside the Adobe app.
 */

/* global CSInterface */

const cs = new CSInterface();
let ws = null;
let connected = false;
let reconnectTimer = null;

const WORKER_ID = 'cep_' + Math.random().toString(36).slice(2, 8);

// ─── Detect which app we're in ────────────────────────────────────────────────

function getHostApp() {
  const id = cs.hostEnvironment.appId;
  const map = { PHXS: 'photoshop', PPRO: 'premiere', AEFT: 'aftereffects', ILST: 'illustrator' };
  return map[id] || id;
}

// ─── ExtendScript execution ───────────────────────────────────────────────────

function evalScript(jsx) {
  return new Promise((resolve, reject) => {
    cs.evalScript(jsx, (result) => {
      if (result === 'EvalScript error.') {
        reject(new Error('EvalScript error'));
      } else {
        resolve(result);
      }
    });
  });
}

// ─── WebSocket connection ─────────────────────────────────────────────────────

function connect() {
  const url = document.getElementById('gatewayUrl').value.trim();
  if (!url) return;

  ws = new WebSocket(url);

  ws.onopen = () => {
    connected = true;
    setStatus('connected', 'Connected to gateway');
    log('Connected as ' + WORKER_ID, 'ok');

    // Register as a worker
    ws.send(JSON.stringify({
      type: 'worker_hello',
      workerId: WORKER_ID,
      capabilities: [getHostApp()],
    }));
  };

  ws.onmessage = async (event) => {
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }

    if (msg.type !== 'execute') return;

    log(`← ${msg.app}/${msg.operation}`);

    try {
      // Build the ExtendScript for this operation
      const jsx = buildScript(msg.app, msg.operation, msg.payload || {});
      if (!jsx) {
        sendResult(msg.requestId, false, null, 'unsupported_operation');
        return;
      }

      const rawResult = await evalScript(jsx);
      let parsed;
      try { parsed = JSON.parse(rawResult); } catch { parsed = { raw: rawResult }; }

      const ok = parsed && parsed.ok !== false;
      log(`→ ${msg.operation}: ${ok ? 'ok' : 'failed'}`, ok ? 'ok' : 'err');
      sendResult(msg.requestId, ok, parsed, ok ? undefined : (parsed.error || 'operation_failed'));
    } catch (err) {
      log(`✗ ${err.message}`, 'err');
      sendResult(msg.requestId, false, null, err.message);
    }
  };

  ws.onclose = () => {
    connected = false;
    setStatus('', 'Disconnected');
    log('Connection closed', 'err');
    scheduleReconnect();
  };

  ws.onerror = () => {
    setStatus('error', 'Connection error');
    log('WebSocket error', 'err');
  };
}

function disconnect() {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (ws) { ws.close(); ws = null; }
  connected = false;
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (!connected) connect();
  }, 5000);
}

function toggleConnect() {
  if (connected) {
    disconnect();
    document.getElementById('connectBtn').textContent = 'Connect';
  } else {
    connect();
    document.getElementById('connectBtn').textContent = 'Disconnect';
  }
}

function sendResult(requestId, ok, output, error) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'result',
      requestId,
      ok,
      output: ok ? output : undefined,
      error: ok ? undefined : error,
      executionMode: 'real',
    }));
  }
}

// ─── Script builder (inline ExtendScript for panel context) ──────────────────

function buildScript(app, operation, payload) {
  // We embed minimal versions of the scripts here — full versions in extendscript-gen.ts
  const key = app + '/' + operation;

  const scripts = {
    'premiere/trim_clip': (p) => `(function(){
      var seq=app.project.activeSequence;if(!seq)return JSON.stringify({ok:false,error:'no_sequence'});
      for(var t=0;t<seq.videoTracks.numTracks;t++){var tr=seq.videoTracks[t];
        for(var c=0;c<tr.clips.numItems;c++){var cl=tr.clips[c];
          if(cl.name===${JSON.stringify(p.clipId)}||String(cl.clipID)===${JSON.stringify(p.clipId)}){
            var i=new Time();i.seconds=parseFloat(${JSON.stringify(p.in)})||0;cl.inPoint=i;
            var o=new Time();o.seconds=parseFloat(${JSON.stringify(p.out)})||0;cl.outPoint=o;
            return JSON.stringify({ok:true,clipId:${JSON.stringify(p.clipId)}});
          }}}return JSON.stringify({ok:false,error:'clip_not_found'});})();`,

    'premiere/delete_clip': (p) => `(function(){
      var seq=app.project.activeSequence;if(!seq)return JSON.stringify({ok:false,error:'no_sequence'});
      for(var t=0;t<seq.videoTracks.numTracks;t++){var tr=seq.videoTracks[t];
        for(var c=tr.clips.numItems-1;c>=0;c--){var cl=tr.clips[c];
          if(cl.name===${JSON.stringify(p.clipId)}||String(cl.clipID)===${JSON.stringify(p.clipId)}){
            cl.remove(false,false);return JSON.stringify({ok:true,deleted:${JSON.stringify(p.clipId)}});
          }}}return JSON.stringify({ok:false,error:'clip_not_found'});})();`,

    'photoshop/apply_lut': (p) => `(function(){
      var doc=app.activeDocument;if(!doc)return JSON.stringify({ok:false,error:'no_doc'});
      try{var desc=new ActionDescriptor();var ref=new ActionReference();
        ref.putClass(charIDToTypeID('AdjL'));desc.putReference(charIDToTypeID('null'),ref);
        var adj=new ActionDescriptor();var lutDesc=new ActionDescriptor();
        lutDesc.putString(stringIDToTypeID('lutIdentifier'),${JSON.stringify(p.lutName)});
        adj.putObject(stringIDToTypeID('colorLookup'),stringIDToTypeID('colorLookup'),lutDesc);
        desc.putObject(charIDToTypeID('Type'),charIDToTypeID('AdjL'),adj);
        executeAction(charIDToTypeID('Mk  '),desc,DialogModes.NO);
        return JSON.stringify({ok:true,lut:${JSON.stringify(p.lutName)}});
      }catch(e){return JSON.stringify({ok:false,error:e.message});}}());`,

    'photoshop/resize': (p) => `(function(){
      var doc=app.activeDocument;if(!doc)return JSON.stringify({ok:false,error:'no_doc'});
      try{doc.resizeImage(new UnitValue(${p.width},'px'),new UnitValue(${p.height},'px'),null,ResampleMethod.BICUBIC);
        return JSON.stringify({ok:true,width:${p.width},height:${p.height}});
      }catch(e){return JSON.stringify({ok:false,error:e.message});}}());`,

    'illustrator/replace_text': (p) => `(function(){
      var doc=app.activeDocument;if(!doc)return JSON.stringify({ok:false,error:'no_doc'});
      for(var i=0;i<doc.textFrames.length;i++){var tf=doc.textFrames[i];
        if(tf.name===${JSON.stringify(p.textObject)}||tf.contents.indexOf(${JSON.stringify(p.textObject)})>=0){
          var old=tf.contents;tf.contents=${JSON.stringify(p.value)};
          return JSON.stringify({ok:true,old:old,new:${JSON.stringify(p.value)}});
        }}return JSON.stringify({ok:false,error:'text_frame_not_found'});})();`,

    'aftereffects/add_keyframe': (p) => `(function(){
      var comp=app.project.activeItem;if(!comp||!(comp instanceof CompItem))return JSON.stringify({ok:false,error:'no_comp'});
      for(var i=1;i<=comp.numLayers;i++){if(comp.layer(i).name===${JSON.stringify(p.layer)}){
        var lyr=comp.layer(i);
        var prop=lyr.property('ADBE Transform Group').property(${JSON.stringify(p.property)});
        if(!prop)return JSON.stringify({ok:false,error:'property_not_found'});
        prop.setValueAtTime(${parseFloat(p.time)||0},${JSON.stringify(p.value)});
        return JSON.stringify({ok:true,layer:${JSON.stringify(p.layer)},property:${JSON.stringify(p.property)}});
      }}return JSON.stringify({ok:false,error:'layer_not_found'});})();`,
  };

  const fn = scripts[key];
  return fn ? fn(payload) : null;
}

// ─── UI helpers ───────────────────────────────────────────────────────────────

function setStatus(dotClass, text) {
  const dot = document.getElementById('dot');
  dot.className = 'dot' + (dotClass ? ' ' + dotClass : '');
  document.getElementById('statusText').textContent = text;
}

const logEl = document.getElementById('log');
function log(msg, cls) {
  const d = document.createElement('div');
  if (cls) d.className = cls;
  d.textContent = new Date().toLocaleTimeString() + ' ' + msg;
  logEl.prepend(d);
  while (logEl.children.length > 50) logEl.removeChild(logEl.lastChild);
}

function clearLog() {
  logEl.innerHTML = '';
}

// Auto-connect on load
connect();
