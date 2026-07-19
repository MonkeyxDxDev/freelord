// host.jsx -- loaded automatically into Illustrator's ExtendScript engine when
// the LayerSync CEP panel opens (via manifest.xml's <ScriptPath>). Unlike a
// plain File > Scripts run, a CEP panel's ExtendScript engine stays resident
// for as long as the panel is open, which is what makes a persistent
// Illustrator panel possible at all -- see README.md.
//
// This file is a self-contained merge of Common/LayerSyncLib.jsx +
// Illustrator/IllustratorSyncCore.jsx (no #include, to avoid relative-path
// issues inside the CEP extension bundle), plus CEP-specific glue at the
// bottom that the panel's JS calls via evalScript().

var LS_UNITS_SCALE = 1;
var LS_mirrorDeleteFlag = false;
var LS_cepLog = ""; // polled by the panel's JS; see LS_cepGetLog() below

function LS_timestamp() {
    var d = new Date();
    function pad(n) { return (n < 10 ? "0" : "") + n; }
    return pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
}

function LS_log(msg) {
    var line = "[" + LS_timestamp() + "] " + msg;
    try { $.writeln(line); } catch (e) {}
    LS_cepLog += (LS_cepLog ? "\n" : "") + line;
    var lines = LS_cepLog.split("\n");
    if (lines.length > 300) LS_cepLog = lines.slice(lines.length - 300).join("\n");
    LS_writeLogFile(line);
}

function LS_writeLogFile(line) {
    try {
        var folder = new Folder(Folder.userData.fsName + "/LayerSync");
        if (!folder.exists) folder.create();
        var f = new File(folder.fsName + "/log.txt");
        f.open("a");
        f.writeln(line);
        f.close();
    } catch (e) {}
}

function LS_round2(n) { return Math.round(n * 100) / 100; }
function LS_clamp01(n) { return Math.max(0, Math.min(1, n)); }

function LS_aiColorToRGB01(c) {
    if (!c) return null;
    try {
        if (c.typename === "RGBColor") {
            return [LS_clamp01(c.red / 255), LS_clamp01(c.green / 255), LS_clamp01(c.blue / 255)];
        }
        if (c.typename === "CMYKColor") {
            var r = 255 * (1 - c.cyan / 100) * (1 - c.black / 100);
            var g = 255 * (1 - c.magenta / 100) * (1 - c.black / 100);
            var b = 255 * (1 - c.yellow / 100) * (1 - c.black / 100);
            return [LS_clamp01(r / 255), LS_clamp01(g / 255), LS_clamp01(b / 255)];
        }
        if (c.typename === "GrayColor") {
            var g2 = 1 - c.gray / 100;
            return [LS_clamp01(g2), LS_clamp01(g2), LS_clamp01(g2)];
        }
    } catch (e) {
        LS_log("Color read failed: " + e);
    }
    return null;
}

function LS_rgb01ToAIColor(rgb) {
    var c = new RGBColor();
    c.red = Math.round(LS_clamp01(rgb[0]) * 255);
    c.green = Math.round(LS_clamp01(rgb[1]) * 255);
    c.blue = Math.round(LS_clamp01(rgb[2]) * 255);
    return c;
}

function LS_targetRunning(targetName) {
    try { return BridgeTalk.isRunning(targetName); } catch (e) { return false; }
}

function LS_send(targetName, code, onResult, onError, timeoutSeconds) {
    if (!LS_targetRunning(targetName)) {
        var msg = "Target '" + targetName + "' is not running. Open it and try again.";
        LS_log(msg);
        if (onError) onError(msg);
        return;
    }
    var bt = new BridgeTalk();
    bt.target = targetName;
    bt.body = code;
    bt.onResult = function (res) { if (onResult) onResult(res.body); };
    bt.onError = function (err) {
        var m = (err && err.body) ? err.body : (err && err.message ? err.message : "unknown BridgeTalk error");
        LS_log("BridgeTalk error: " + m);
        if (onError) onError(m);
    };
    bt.send(timeoutSeconds || 30);
}

function LS_testConnection(targetName, onSuccess, onError) {
    LS_send(targetName, "1+1;", function (body) {
        if (body === "2") {
            LS_log("Connection to '" + targetName + "' OK.");
            if (onSuccess) onSuccess();
        } else {
            var m = "Unexpected reply from '" + targetName + "': " + body;
            LS_log(m);
            if (onError) onError(m);
        }
    }, onError);
}

// ---- Coordinate bridge --------------------------------------------------------------

function LS_getActiveArtboardCenter(doc) {
    var idx = doc.artboards.getActiveArtboardIndex();
    var rect = doc.artboards[idx].artboardRect;
    return { x: (rect[0] + rect[2]) / 2, y: (rect[1] + rect[3]) / 2 };
}

function LS_aiPosToWire(pt, center) {
    return [LS_round2((pt[0] - center.x) / LS_UNITS_SCALE), LS_round2(-(pt[1] - center.y) / LS_UNITS_SCALE)];
}

function LS_wireToAIPos(pt, center) {
    return [pt[0] * LS_UNITS_SCALE + center.x, center.y - pt[1] * LS_UNITS_SCALE];
}

function LS_aiVecToWire(v) {
    return [LS_round2(v[0] / LS_UNITS_SCALE), LS_round2(-v[1] / LS_UNITS_SCALE)];
}

function LS_wireToAIVec(v) {
    return [v[0] * LS_UNITS_SCALE, -v[1] * LS_UNITS_SCALE];
}

function LS_aiAngleToWire(aiAngle) { return LS_round2(-aiAngle); }
function LS_wireAngleToAI(wireAngle) { return -wireAngle; }

// ---- Blend mode (best-effort) ---------------------------------------

function LS_readAIBlendMode(item) {
    try {
        if (item.blendingMode !== undefined && item.blendingMode !== null) return String(item.blendingMode);
    } catch (e) {}
    return "NORMAL";
}

function LS_applyAIBlendMode(item, name) {
    if (!name || name === "NORMAL") return;
    try {
        item.blendingMode = name;
    } catch (e) {
        LS_log("Could not apply blend mode '" + name + "' to '" + item.name + "' -- this Illustrator version may not expose a scriptable blend mode property.");
    }
}

// =========================== Tree reading (AI -> wire) ===========================

function LS_classifyAIItem(item) {
    if (item.typename === "GroupItem" || item.typename === "Layer") return "group";
    if (item.typename === "TextFrame") return "text";
    if (item.typename === "PathItem" || item.typename === "CompoundPathItem") return "shape";
    return "other";
}

function LS_collectContainerChildren(container) {
    var out = [];
    var items = container.pageItems;
    for (var i = 0; i < items.length; i++) out.push(items[i]);
    if (container.typename === "Layer" && container.layers) {
        for (var j = 0; j < container.layers.length; j++) out.push(container.layers[j]);
    }
    return out;
}

function LS_readAIShape(item, center) {
    try {
        var pts = item.pathPoints;
        if (!pts || pts.length === 0) return null;
        var b = item.geometricBounds;
        var refX = (b[0] + b[2]) / 2, refY = (b[1] + b[3]) / 2;

        var vertices = [], inT = [], outT = [];
        for (var i = 0; i < pts.length; i++) {
            var p = pts[i];
            var a = p.anchor;
            var localAnchor = [a[0] - refX, a[1] - refY];
            vertices.push(LS_aiVecToWire(localAnchor));
            inT.push(LS_aiVecToWire([p.leftDirection[0] - a[0], p.leftDirection[1] - a[1]]));
            outT.push(LS_aiVecToWire([p.rightDirection[0] - a[0], p.rightDirection[1] - a[1]]));
        }

        var shape = {
            closed: item.closed, vertices: vertices, inTangents: inT, outTangents: outT,
            fillColor: null, fillGradient: null,
            strokeColor: item.stroked ? LS_aiColorToRGB01(item.strokeColor) : null,
            strokeWidth: item.stroked ? item.strokeWidth : 0
        };
        if (item.filled) {
            if (item.fillColor.typename === "GradientColor") {
                var gc = item.fillColor;
                var stops = [];
                for (var s = 0; s < gc.gradient.gradientStops.length; s++) {
                    var gs = gc.gradient.gradientStops[s];
                    stops.push({ ramp: gs.rampPoint, color: LS_aiColorToRGB01(gs.color) || [0, 0, 0] });
                }
                shape.fillGradient = { type: gc.gradient.type === GradientType.RADIAL ? "radial" : "linear", angle: LS_aiAngleToWire(gc.angle), stops: stops };
            } else {
                shape.fillColor = LS_aiColorToRGB01(item.fillColor);
            }
        }
        var transform = { position: LS_aiPosToWire([refX, refY], center), scale: [100, 100], rotation: 0, opacity: (item.opacity !== undefined) ? item.opacity : 100 };
        return { shape: shape, transform: transform };
    } catch (e) {
        LS_log("AI shape read failed on '" + item.name + "': " + e);
        return null;
    }
}

function LS_readAIText(item, center) {
    try {
        var ta = item.textRange.characterAttributes;
        var just = "left";
        try {
            var j = item.paragraphs[0].paragraphAttributes.justification;
            if (j === Justification.CENTER) just = "center";
            else if (j === Justification.RIGHT) just = "right";
        } catch (e2) {}
        var b = item.geometricBounds;
        var refX = (b[0] + b[2]) / 2, refY = (b[1] + b[3]) / 2;
        var text = { contents: item.contents, fontName: ta.textFont ? ta.textFont.name : "", fontSize: ta.size, fillColor: LS_aiColorToRGB01(ta.fillColor) || [0, 0, 0], justification: just };
        var transform = { position: LS_aiPosToWire([refX, refY], center), scale: [100, 100], rotation: 0, opacity: (item.opacity !== undefined) ? item.opacity : 100 };
        return { text: text, transform: transform };
    } catch (e) {
        LS_log("AI text read failed on '" + item.name + "': " + e);
        return null;
    }
}

function LS_buildAINode(item, center) {
    var kind = LS_classifyAIItem(item);
    if (kind === "other") return null;
    var node = { name: item.name || item.typename, kind: kind, visible: (item.hidden !== undefined) ? !item.hidden : true, blendMode: LS_readAIBlendMode(item) };
    if (kind === "group") {
        node.transform = { position: [0, 0], scale: [100, 100], rotation: 0, opacity: 100 };
        node.children = [];
        var kids = LS_collectContainerChildren(item);
        for (var i = 0; i < kids.length; i++) {
            var childNode = LS_buildAINode(kids[i], center);
            if (childNode) node.children.push(childNode);
        }
    } else if (kind === "text") {
        var tr = LS_readAIText(item, center);
        if (!tr) return null;
        node.transform = tr.transform; node.text = tr.text;
    } else if (kind === "shape") {
        var sr = LS_readAIShape(item, center);
        if (!sr) return null;
        node.transform = sr.transform; node.shape = sr.shape;
    }
    return node;
}

function LS_buildAITree() {
    var doc = app.activeDocument;
    if (!doc) { LS_log("No active document."); return null; }
    var center = LS_getActiveArtboardCenter(doc);
    var ab = doc.artboards[doc.artboards.getActiveArtboardIndex()].artboardRect;
    var width = Math.abs(ab[2] - ab[0]) / LS_UNITS_SCALE;
    var height = Math.abs(ab[1] - ab[3]) / LS_UNITS_SCALE;
    var out = [];
    for (var i = 0; i < doc.layers.length; i++) {
        var node = LS_buildAINode(doc.layers[i], center);
        if (node) out.push(node);
    }
    return { version: 1, source: "AI", canvas: { width: width, height: height }, layers: out };
}

// =========================== Tree applying (wire -> AI) ===========================

function LS_findAIChildByName(container, name) {
    var items = container.pageItems;
    for (var i = 0; i < items.length; i++) if (items[i].name === name) return items[i];
    return null;
}

function LS_createOrUpdateAIShape(container, node, center) {
    var item = LS_findAIChildByName(container, node.name);
    if (item && item.typename !== "PathItem") { item.remove(); item = null; }
    if (!item) { item = container.pathItems.add(); item.name = node.name; }
    item.hidden = node.visible === false;
    LS_applyAIBlendMode(item, node.blendMode);

    if (node.shape) {
        if (node.shape.fillGradient) {
            var fg = node.shape.fillGradient;
            var g = new Gradient();
            g.type = fg.type === "radial" ? GradientType.RADIAL : GradientType.LINEAR;
            for (var si = 0; si < fg.stops.length; si++) {
                var gstop = (si < g.gradientStops.length) ? g.gradientStops[si] : g.gradientStops.add();
                gstop.rampPoint = fg.stops[si].ramp; gstop.color = LS_rgb01ToAIColor(fg.stops[si].color);
            }
            while (g.gradientStops.length > fg.stops.length && g.gradientStops.length > 2) g.gradientStops[g.gradientStops.length - 1].remove();
            var gc2 = new GradientColor();
            gc2.gradient = g; gc2.angle = LS_wireAngleToAI(fg.angle);
            item.filled = true; item.fillColor = gc2;
        } else {
            item.filled = !!node.shape.fillColor;
            if (item.filled) item.fillColor = LS_rgb01ToAIColor(node.shape.fillColor);
        }
        item.stroked = !!node.shape.strokeColor;
        if (item.stroked) { item.strokeColor = LS_rgb01ToAIColor(node.shape.strokeColor); item.strokeWidth = node.shape.strokeWidth || 1; }

        var itemCenter = LS_wireToAIPos(node.transform.position, center);
        while (item.pathPoints.length > 0) item.pathPoints[item.pathPoints.length - 1].remove();
        for (var i = 0; i < node.shape.vertices.length; i++) {
            var pp = item.pathPoints.add();
            var v = LS_wireToAIVec(node.shape.vertices[i]);
            var it = LS_wireToAIVec(node.shape.inTangents[i]);
            var ot = LS_wireToAIVec(node.shape.outTangents[i]);
            var ax = itemCenter[0] + v[0], ay = itemCenter[1] + v[1];
            pp.anchor = [ax, ay]; pp.leftDirection = [ax + it[0], ay + it[1]]; pp.rightDirection = [ax + ot[0], ay + ot[1]];
            pp.pointType = PointType.SMOOTH;
        }
        item.closed = node.shape.closed;
    }
    return item;
}

function LS_createOrUpdateAIText(container, node, center) {
    var item = LS_findAIChildByName(container, node.name);
    if (item && item.typename !== "TextFrame") { item.remove(); item = null; }
    if (!item) { item = container.textFrames.add(); item.name = node.name; }
    item.hidden = node.visible === false;
    LS_applyAIBlendMode(item, node.blendMode);

    if (node.text) {
        item.contents = node.text.contents;
        var ta = item.textRange.characterAttributes;
        try { ta.textFont = app.textFonts.getByName(node.text.fontName); }
        catch (e) { LS_log("Font '" + node.text.fontName + "' not found in Illustrator, keeping default."); }
        ta.size = node.text.fontSize;
        ta.fillColor = LS_rgb01ToAIColor(node.text.fillColor);
        try {
            item.paragraphs[0].paragraphAttributes.justification = node.text.justification === "center" ? Justification.CENTER : node.text.justification === "right" ? Justification.RIGHT : Justification.LEFT;
        } catch (e2) {}
        var b = item.geometricBounds;
        var curCenterX = (b[0] + b[2]) / 2, curCenterY = (b[1] + b[3]) / 2;
        var targetCenter = LS_wireToAIPos(node.transform.position, center);
        var dx = targetCenter[0] - curCenterX, dy = targetCenter[1] - curCenterY;
        item.position = [item.position[0] + dx, item.position[1] + dy];
    }
    return item;
}

function LS_createOrUpdateAIGroup(container, node) {
    var item = LS_findAIChildByName(container, node.name);
    if (item && item.typename !== "GroupItem") { item.remove(); item = null; }
    if (!item) { item = container.groupItems.add(); item.name = node.name; }
    item.hidden = node.visible === false;
    LS_applyAIBlendMode(item, node.blendMode);
    return item;
}

function LS_applyNodesAI(container, nodes, center, mirrorDelete) {
    var incomingNames = {};
    for (var i = 0; i < nodes.length; i++) incomingNames[nodes[i].name] = true;
    if (mirrorDelete) {
        var items = container.pageItems;
        for (var j = items.length - 1; j >= 0; j--) {
            if (!incomingNames[items[j].name]) { LS_log("Removing AI item not in source: " + items[j].name); items[j].remove(); }
        }
    }
    for (var k = 0; k < nodes.length; k++) {
        var node = nodes[k];
        var item;
        if (node.kind === "shape") item = LS_createOrUpdateAIShape(container, node, center);
        else if (node.kind === "text") item = LS_createOrUpdateAIText(container, node, center);
        else item = LS_createOrUpdateAIGroup(container, node);
        if (node.children && node.children.length) LS_applyNodesAI(item, node.children, center, mirrorDelete);
    }
}

function LS_applyIncomingTree(tree) {
    var doc = app.activeDocument;
    if (!doc) { LS_log("Apply failed: no active document."); return; }
    var center = LS_getActiveArtboardCenter(doc);
    try {
        LS_applyNodesAI(doc, tree.layers, center, LS_mirrorDeleteFlag);
        LS_log("Applied incoming tree from " + tree.source + " (" + tree.layers.length + " root layers).");
        app.redraw();
    } catch (e) { LS_log("Apply error: " + e); }
}

function LS_getTreeSource() {
    var tree = LS_buildAITree();
    if (!tree) return "null";
    return tree.toSource();
}

// =========================== CEP-facing glue ===========================
// Called by client/main.js via evalScript(). BridgeTalk's send is async, so
// these don't return the final result directly -- the panel polls
// LS_cepGetLog() and watches for the completion line these write via LS_log.

function LS_cepSetOptions(mirrorDelete, unitsScale) {
    LS_mirrorDeleteFlag = !!mirrorDelete;
    var v = parseFloat(unitsScale);
    if (!isNaN(v) && v > 0) LS_UNITS_SCALE = v;
}

function LS_cepPush() {
    LS_log("Pushing to After Effects...");
    var tree = LS_buildAITree();
    if (!tree) { LS_log("Push failed: no active document."); return; }
    LS_send("aftereffects", "LS_applyIncomingTree(" + tree.toSource() + ");", function () {
        LS_log("Push complete: sent " + tree.layers.length + " root layer(s).");
    }, function (err) {
        LS_log("Push failed: " + err);
    });
}

function LS_cepPull() {
    LS_log("Pulling from After Effects...");
    LS_send("aftereffects", "LS_getTreeSource();", function (body) {
        try {
            var tree = eval(body);
            if (!tree) { LS_log("After Effects returned no data."); return; }
            LS_applyIncomingTree(tree);
            LS_log("Pull complete: applied " + tree.layers.length + " root layer(s).");
        } catch (e) {
            LS_log("Failed to parse After Effects response: " + e);
        }
    }, function (err) {
        LS_log("Pull failed: " + err);
    });
}

function LS_cepTestConnection() {
    LS_testConnection("aftereffects", function () {}, function () {});
}

function LS_cepGetLog() {
    return LS_cepLog;
}

LS_log("LayerSync host engine loaded.");
