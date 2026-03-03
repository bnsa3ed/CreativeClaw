/**
 * ExtendScript (JSX) code generator for Adobe operations.
 * Returns a self-contained ExtendScript string for each operation.
 */

export interface ExtendScriptResult {
  ok: boolean;
  output?: unknown;
  error?: string;
}

// ─── Premiere Pro ────────────────────────────────────────────────────────────

export function premiere_trim_clip(payload: Record<string, unknown>): string {
  const { clipId, in: inPoint, out: outPoint } = payload;
  return `
(function() {
  var proj = app.project;
  if (!proj) { return JSON.stringify({ ok: false, error: 'no_project_open' }); }
  var seq = proj.activeSequence;
  if (!seq) { return JSON.stringify({ ok: false, error: 'no_active_sequence' }); }
  var clipId = ${JSON.stringify(clipId)};
  var inPoint = ${JSON.stringify(inPoint)};
  var outPoint = ${JSON.stringify(outPoint)};
  for (var t = 0; t < seq.videoTracks.numTracks; t++) {
    var track = seq.videoTracks[t];
    for (var c = 0; c < track.clips.numItems; c++) {
      var clip = track.clips[c];
      if (clip.name === clipId || String(clip.clipID) === clipId) {
        clip.inPoint = new Time();
        clip.inPoint.seconds = parseFloat(inPoint) || 0;
        clip.outPoint = new Time();
        clip.outPoint.seconds = parseFloat(outPoint) || clip.outPoint.seconds;
        return JSON.stringify({ ok: true, clipId: clipId, in: inPoint, out: outPoint });
      }
    }
  }
  return JSON.stringify({ ok: false, error: 'clip_not_found', clipId: clipId });
})();
`.trim();
}

export function premiere_insert_clip(payload: Record<string, unknown>): string {
  const { assetPath, track, timecode } = payload;
  return `
(function() {
  var proj = app.project;
  if (!proj) { return JSON.stringify({ ok: false, error: 'no_project_open' }); }
  var seq = proj.activeSequence;
  if (!seq) { return JSON.stringify({ ok: false, error: 'no_active_sequence' }); }
  var assetPath = ${JSON.stringify(assetPath)};
  var trackIdx = parseInt(${JSON.stringify(track)}) || 0;
  var tc = ${JSON.stringify(timecode)};
  var importArr = new Array(assetPath);
  proj.importFiles(importArr, false, proj.rootItem, false);
  var item;
  for (var i = 0; i < proj.rootItem.children.numItems; i++) {
    if (proj.rootItem.children[i].getMediaPath() === assetPath) {
      item = proj.rootItem.children[i];
      break;
    }
  }
  if (!item) { return JSON.stringify({ ok: false, error: 'import_failed' }); }
  var insertTime = new Time();
  insertTime.seconds = parseFloat(tc) || 0;
  seq.videoTracks[trackIdx].insertClip(item, insertTime);
  return JSON.stringify({ ok: true, assetPath: assetPath, track: trackIdx, timecode: tc });
})();
`.trim();
}

export function premiere_delete_clip(payload: Record<string, unknown>): string {
  const { clipId } = payload;
  return `
(function() {
  var proj = app.project;
  var seq = proj.activeSequence;
  if (!seq) { return JSON.stringify({ ok: false, error: 'no_active_sequence' }); }
  var clipId = ${JSON.stringify(clipId)};
  for (var t = 0; t < seq.videoTracks.numTracks; t++) {
    var track = seq.videoTracks[t];
    for (var c = track.clips.numItems - 1; c >= 0; c--) {
      var clip = track.clips[c];
      if (clip.name === clipId || String(clip.clipID) === clipId) {
        clip.remove(false, false);
        return JSON.stringify({ ok: true, deleted: clipId });
      }
    }
  }
  return JSON.stringify({ ok: false, error: 'clip_not_found' });
})();
`.trim();
}

export function premiere_export_sequence(payload: Record<string, unknown>): string {
  const { outputPath, preset } = payload;
  return `
(function() {
  var proj = app.project;
  var seq = proj.activeSequence;
  if (!seq) { return JSON.stringify({ ok: false, error: 'no_active_sequence' }); }
  var encoderPreset = ${JSON.stringify(preset || 'H.264 - Match Source - High bitrate')};
  var outPath = ${JSON.stringify(outputPath || '/tmp/creativeclaw_export.mp4')};
  app.encoder.launchEncoder();
  app.encoder.encodeSequence(seq, outPath, encoderPreset, app.encoder.ENCODE_IN_TO_OUT, false);
  return JSON.stringify({ ok: true, outputPath: outPath, preset: encoderPreset, status: 'encoding_queued' });
})();
`.trim();
}

// ─── After Effects ────────────────────────────────────────────────────────────

export function aftereffects_add_keyframe(payload: Record<string, unknown>): string {
  const { layer, property, time, value } = payload;
  return `
(function() {
  var proj = app.project;
  if (!proj) { return JSON.stringify({ ok: false, error: 'no_project_open' }); }
  var comp = proj.activeItem;
  if (!comp || !(comp instanceof CompItem)) { return JSON.stringify({ ok: false, error: 'no_active_composition' }); }
  var layerName = ${JSON.stringify(layer)};
  var propName = ${JSON.stringify(property)};
  var t = parseFloat(${JSON.stringify(time)}) || 0;
  var val = ${JSON.stringify(value)};
  var lyr;
  for (var i = 1; i <= comp.numLayers; i++) {
    if (comp.layer(i).name === layerName) { lyr = comp.layer(i); break; }
  }
  if (!lyr) { return JSON.stringify({ ok: false, error: 'layer_not_found', layer: layerName }); }
  var prop = lyr.property('ADBE Transform Group').property(propName);
  if (!prop) { return JSON.stringify({ ok: false, error: 'property_not_found', property: propName }); }
  prop.setValueAtTime(t, val);
  return JSON.stringify({ ok: true, layer: layerName, property: propName, time: t, value: val });
})();
`.trim();
}

export function aftereffects_render_comp(payload: Record<string, unknown>): string {
  const { compName, outputPath, template } = payload;
  return `
(function() {
  var proj = app.project;
  var compName = ${JSON.stringify(compName || '')};
  var outPath = ${JSON.stringify(outputPath || '/tmp/creativeclaw_render.mp4')};
  var template = ${JSON.stringify(template || 'Best Settings')};
  var comp;
  for (var i = 1; i <= proj.numItems; i++) {
    if (proj.item(i) instanceof CompItem && (proj.item(i).name === compName || !compName)) {
      comp = proj.item(i); break;
    }
  }
  if (!comp) { return JSON.stringify({ ok: false, error: 'comp_not_found', compName: compName }); }
  var rq = app.project.renderQueue;
  var rqi = rq.items.add(comp);
  rqi.outputModules[1].file = new File(outPath);
  rq.render();
  return JSON.stringify({ ok: true, comp: comp.name, outputPath: outPath, status: 'render_queued' });
})();
`.trim();
}

export function aftereffects_delete_layer(payload: Record<string, unknown>): string {
  const { layer } = payload;
  return `
(function() {
  var comp = app.project.activeItem;
  if (!comp || !(comp instanceof CompItem)) { return JSON.stringify({ ok: false, error: 'no_active_composition' }); }
  var layerName = ${JSON.stringify(layer)};
  for (var i = 1; i <= comp.numLayers; i++) {
    if (comp.layer(i).name === layerName) {
      comp.layer(i).remove();
      return JSON.stringify({ ok: true, deleted: layerName });
    }
  }
  return JSON.stringify({ ok: false, error: 'layer_not_found', layer: layerName });
})();
`.trim();
}

// ─── Photoshop ───────────────────────────────────────────────────────────────

export function photoshop_apply_lut(payload: Record<string, unknown>): string {
  const { layer, lutName } = payload;
  return `
(function() {
  var doc = app.activeDocument;
  if (!doc) { return JSON.stringify({ ok: false, error: 'no_document_open' }); }
  var layerName = ${JSON.stringify(layer)};
  var lutName = ${JSON.stringify(lutName)};
  var lyr = doc.activeLayer;
  try {
    for (var i = 0; i < doc.layers.length; i++) {
      if (doc.layers[i].name === layerName) { doc.activeLayer = doc.layers[i]; lyr = doc.layers[i]; break; }
    }
    var desc = new ActionDescriptor();
    var ref = new ActionReference();
    ref.putClass(charIDToTypeID('AdjL'));
    desc.putReference(charIDToTypeID('null'), ref);
    var adj = new ActionDescriptor();
    var lutDesc = new ActionDescriptor();
    lutDesc.putString(stringIDToTypeID('lutIdentifier'), lutName);
    adj.putObject(stringIDToTypeID('colorLookup'), stringIDToTypeID('colorLookup'), lutDesc);
    desc.putObject(charIDToTypeID('Type'), charIDToTypeID('AdjL'), adj);
    executeAction(charIDToTypeID('Mk  '), desc, DialogModes.NO);
    return JSON.stringify({ ok: true, layer: layerName, lut: lutName });
  } catch(e) {
    return JSON.stringify({ ok: false, error: e.message, layer: layerName, lut: lutName });
  }
})();
`.trim();
}

export function photoshop_apply_curves(payload: Record<string, unknown>): string {
  const { channel, points } = payload;
  return `
(function() {
  var doc = app.activeDocument;
  if (!doc) { return JSON.stringify({ ok: false, error: 'no_document_open' }); }
  try {
    var curves = new CurvePointCollection();
    var pts = ${JSON.stringify(points || [[0,0],[128,128],[255,255]])};
    var adj = doc.activeLayer.adjustments.add();
    // Use action descriptor for curves
    var desc = new ActionDescriptor();
    var ref = new ActionReference();
    ref.putClass(charIDToTypeID('AdjL'));
    desc.putReference(charIDToTypeID('null'), ref);
    var adjDesc = new ActionDescriptor();
    var curvesDesc = new ActionDescriptor();
    var channelStr = ${JSON.stringify(channel || 'composite')};
    curvesDesc.putString(stringIDToTypeID('channel'), channelStr);
    var ptsList = new ActionList();
    for (var i = 0; i < pts.length; i++) {
      var ptDesc = new ActionDescriptor();
      ptDesc.putDouble(charIDToTypeID('Hrzn'), pts[i][0]);
      ptDesc.putDouble(charIDToTypeID('Vrtc'), pts[i][1]);
      ptsList.putObject(stringIDToTypeID('curvePoint'), ptDesc);
    }
    curvesDesc.putList(stringIDToTypeID('curvePoints'), ptsList);
    adjDesc.putObject(stringIDToTypeID('curves'), stringIDToTypeID('curves'), curvesDesc);
    desc.putObject(charIDToTypeID('Type'), charIDToTypeID('AdjL'), adjDesc);
    executeAction(charIDToTypeID('Mk  '), desc, DialogModes.NO);
    return JSON.stringify({ ok: true, channel: channelStr, points: pts });
  } catch(e) {
    return JSON.stringify({ ok: false, error: e.message });
  }
})();
`.trim();
}

export function photoshop_resize(payload: Record<string, unknown>): string {
  const { width, height, resample } = payload;
  return `
(function() {
  var doc = app.activeDocument;
  if (!doc) { return JSON.stringify({ ok: false, error: 'no_document_open' }); }
  try {
    var w = ${JSON.stringify(width)};
    var h = ${JSON.stringify(height)};
    var resampleMap = {
      bicubic: ResampleMethod.BICUBIC,
      bilinear: ResampleMethod.BILINEAR,
      nearest: ResampleMethod.NEARESTNEIGHBOR,
      preserve: ResampleMethod.PRESERVEDETAILS
    };
    var method = resampleMap[${JSON.stringify(resample || 'bicubic')}] || ResampleMethod.BICUBIC;
    doc.resizeImage(new UnitValue(w, 'px'), new UnitValue(h, 'px'), null, method);
    return JSON.stringify({ ok: true, width: w, height: h });
  } catch(e) {
    return JSON.stringify({ ok: false, error: e.message });
  }
})();
`.trim();
}

export function photoshop_export(payload: Record<string, unknown>): string {
  const { outputPath, format } = payload;
  return `
(function() {
  var doc = app.activeDocument;
  if (!doc) { return JSON.stringify({ ok: false, error: 'no_document_open' }); }
  var outPath = ${JSON.stringify(outputPath || '/tmp/creativeclaw_export.jpg')};
  var fmt = ${JSON.stringify(format || 'jpeg')}.toLowerCase();
  try {
    var file = new File(outPath);
    if (fmt === 'jpeg' || fmt === 'jpg') {
      var opts = new JPEGSaveOptions();
      opts.quality = 10;
      doc.saveAs(file, opts, true);
    } else if (fmt === 'png') {
      var opts = new PNGSaveOptions();
      doc.saveAs(file, opts, true);
    } else if (fmt === 'tiff') {
      var opts = new TiffSaveOptions();
      doc.saveAs(file, opts, true);
    } else {
      doc.save();
    }
    return JSON.stringify({ ok: true, outputPath: outPath, format: fmt });
  } catch(e) {
    return JSON.stringify({ ok: false, error: e.message });
  }
})();
`.trim();
}

// ─── Illustrator ─────────────────────────────────────────────────────────────

export function illustrator_replace_text(payload: Record<string, unknown>): string {
  const { textObject, value } = payload;
  return `
(function() {
  var doc = app.activeDocument;
  if (!doc) { return JSON.stringify({ ok: false, error: 'no_document_open' }); }
  var objectName = ${JSON.stringify(textObject)};
  var newText = ${JSON.stringify(value)};
  try {
    for (var i = 0; i < doc.textFrames.length; i++) {
      var tf = doc.textFrames[i];
      if (tf.name === objectName || tf.contents.indexOf(objectName) >= 0) {
        var oldText = tf.contents;
        tf.contents = newText;
        return JSON.stringify({ ok: true, textObject: objectName, old: oldText, new: newText });
      }
    }
    return JSON.stringify({ ok: false, error: 'text_frame_not_found', textObject: objectName });
  } catch(e) {
    return JSON.stringify({ ok: false, error: e.message });
  }
})();
`.trim();
}

export function illustrator_export(payload: Record<string, unknown>): string {
  const { outputPath, format } = payload;
  return `
(function() {
  var doc = app.activeDocument;
  if (!doc) { return JSON.stringify({ ok: false, error: 'no_document_open' }); }
  var outPath = ${JSON.stringify(outputPath || '/tmp/creativeclaw_export.pdf')};
  var fmt = ${JSON.stringify(format || 'pdf')}.toLowerCase();
  try {
    var file = new File(outPath);
    if (fmt === 'pdf') {
      var opts = new PDFSaveOptions();
      doc.saveAs(file, opts);
    } else if (fmt === 'svg') {
      var opts = new ExportOptionsSVG();
      doc.exportFile(file, ExportType.SVG, opts);
    } else if (fmt === 'png') {
      var opts = new ExportOptionsPNG24();
      doc.exportFile(file, ExportType.PNG24, opts);
    }
    return JSON.stringify({ ok: true, outputPath: outPath, format: fmt });
  } catch(e) {
    return JSON.stringify({ ok: false, error: e.message });
  }
})();
`.trim();
}

// ─── Registry ────────────────────────────────────────────────────────────────

export type ExtendScriptGenerator = (payload: Record<string, unknown>) => string;

export const scriptGenerators: Record<string, ExtendScriptGenerator> = {
  'premiere/trim_clip': premiere_trim_clip,
  'premiere/insert_clip': premiere_insert_clip,
  'premiere/delete_clip': premiere_delete_clip,
  'premiere/export_sequence': premiere_export_sequence,
  'aftereffects/add_keyframe': aftereffects_add_keyframe,
  'aftereffects/render_comp': aftereffects_render_comp,
  'aftereffects/delete_layer': aftereffects_delete_layer,
  'photoshop/apply_lut': photoshop_apply_lut,
  'photoshop/apply_curves': photoshop_apply_curves,
  'photoshop/resize': photoshop_resize,
  'photoshop/export': photoshop_export,
  'illustrator/replace_text': illustrator_replace_text,
  'illustrator/export': illustrator_export,
};

export function generateScript(app: string, operation: string, payload: Record<string, unknown>): string | null {
  const gen = scriptGenerators[`${app}/${operation}`];
  return gen ? gen(payload) : null;
}
